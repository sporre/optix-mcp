#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildSchema, parse } from "graphql";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { checkDeprecatedArguments } from "./helpers/deprecation.js";
import {
	introspectEndpoint,
	introspectLocalSchema,
	introspectSchemaFromUrl,
} from "./helpers/introspection.js";
import { getVersion } from "./helpers/package.js";

// Import Optix business tools
import { createOptixTools } from "./optix/tools.js";

// Check for deprecated command line arguments
checkDeprecatedArguments();

const EnvSchema = z.object({
	NAME: z.string().default("mcp-graphql"),
	ENDPOINT: z.string().url().default("http://localhost:4000/graphql"),
	ALLOW_MUTATIONS: z
		.enum(["true", "false"])
		.transform((value) => value === "true")
		.default("false"),
	HEADERS: z
		.string()
		.default("{}")
		.transform((val) => {
			try {
				return JSON.parse(val);
			} catch (e) {
				throw new Error("HEADERS must be a valid JSON string");
			}
		}),
	SCHEMA: z.string().optional(),
});

const env = EnvSchema.parse(process.env);

function resolveLocalSchemaPath() {
	const currentDir = dirname(fileURLToPath(import.meta.url));
	const candidate = resolve(currentDir, "../schema.full.graphql");
	return existsSync(candidate) ? candidate : undefined;
}

const localSchemaPath = resolveLocalSchemaPath();
const schemaSource = env.SCHEMA ?? localSchemaPath;

async function loadSchemaWithFallback() {
	if (schemaSource) {
		if (
			schemaSource.startsWith("http://") ||
			schemaSource.startsWith("https://")
		) {
			return introspectSchemaFromUrl(schemaSource);
		}

		const localSchema = await introspectLocalSchema(schemaSource);
		try {
			buildSchema(localSchema);
			return localSchema;
		} catch (error) {
			const remoteSchema = await introspectEndpoint(env.ENDPOINT, env.HEADERS);
			try {
				await writeFile(schemaSource, remoteSchema);
			} catch (writeError) {
				console.error(
					`Failed to update local schema at ${schemaSource}: ${writeError}`,
				);
			}
			return remoteSchema;
		}
	}

	return introspectEndpoint(env.ENDPOINT, env.HEADERS);
}

async function loadSchemaForSearch() {
	if (schemaSource && !schemaSource.startsWith("http")) {
		return introspectLocalSchema(schemaSource);
	}

	return loadSchemaWithFallback();
}

// Detect if this is an Optix API endpoint
const IS_OPTIX = env.ENDPOINT.includes("optixapp.com") || env.ENDPOINT.includes("optix");

const OPTIX_INSTRUCTIONS = `Optix business rules for revenue and membership reporting:

MRR normalization (Monthly Recurring Revenue):
Plans have a "price_frequency" (PlanFrequency enum). Always normalize a plan's price to a monthly value before reporting or summing MRR. Use these multipliers (price * factor = MRR):
  DAILY        -> 30.42
  WEEKLY       -> 4.34
  BIWEEKLY     -> 2.17
  THIRTY_DAYS  -> 1
  MONTHLY      -> 1
  SIXTY_DAYS   -> 0.5
  NINETY_DAYS  -> 0.3333
  QUARTERLY    -> 0.3333
  BIANNUAL     -> 0.1667
  ANNUAL       -> 0.0833
Never sum raw plan prices across mixed frequencies without normalizing first.

Personal vs Team plan attribution:
Accounts have a "type" field; relevant values include "Member" (personal account) and "Team" (team/company account). A Member can belong to one or more Teams. When a Member's plan is actually paid by their Team, the MRR belongs to the Team, not to the individual Member.
When attributing MRR or listing paying entities:
  - Roll up a Member's plan MRR to their Team if they are part of one.
  - When reporting workspace-level MRR, prefer aggregating by paying account (Team where applicable, Member otherwise) to avoid double-counting.
  - When showing per-member breakdowns, clearly flag which MRR is personal vs attributed to the Team they belong to.
`;

const server = new McpServer(
	{
		name: env.NAME,
		version: getVersion(),
		description: `GraphQL MCP server for ${env.ENDPOINT}${IS_OPTIX ? " (with Optix business tools)" : ""}`,
	},
	IS_OPTIX ? { instructions: OPTIX_INSTRUCTIONS } : undefined,
);

server.resource("graphql-schema", new URL(env.ENDPOINT).href, async (uri) => {
	try {
		const schema = await loadSchemaWithFallback();

		return {
			contents: [
				{
					uri: uri.href,
					text: schema,
				},
			],
		};
	} catch (error) {
		throw new Error(`Failed to get GraphQL schema: ${error}`);
	}
});

server.tool(
	"introspect-schema",
	"Introspect the GraphQL schema, use this tool before doing a query to get the schema information if you do not have it available as a resource already.",
	{
		// This is a workaround to help clients that can't handle an empty object as an argument
		// They will often send undefined instead of an empty object which is not allowed by the schema
		__ignore__: z
			.boolean()
			.default(false)
			.describe("This does not do anything"),
	},
	async () => {
		try {
			const schema = await loadSchemaWithFallback();

			return {
				content: [
					{
						type: "text",
						text: schema,
					},
				],
			};
		} catch (error) {
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: `Failed to introspect schema: ${error}`,
					},
				],
			};
		}
	},
);

server.tool(
	"search-schema",
	"Search the GraphQL schema text and return matching lines with small context. Useful to avoid dumping the full schema.",
	{
		query: z.string().min(1),
		max_results: z.number().int().min(1).max(200).default(10),
		context_lines: z.number().int().min(0).max(5).default(0),
		case_sensitive: z.boolean().default(false),
		max_output_chars: z.number().int().min(200).max(8000).default(2000),
	},
	async ({ query, max_results, context_lines, case_sensitive, max_output_chars }) => {
		try {
			const schema = await loadSchemaForSearch();
			const lines = schema.split(/\r?\n/);
			const needle = case_sensitive ? query : query.toLowerCase();
			const results: string[] = [];
			const seen = new Set<string>();
			let matches = 0;

			for (let i = 0; i < lines.length; i++) {
				const hay = case_sensitive ? lines[i] : lines[i].toLowerCase();
				if (!hay.includes(needle)) continue;

				matches += 1;
				const start = Math.max(0, i - context_lines);
				const end = Math.min(lines.length - 1, i + context_lines);

				for (let j = start; j <= end; j++) {
					const key = `${j}:${lines[j]}`;
					if (seen.has(key)) continue;
					seen.add(key);
					results.push(`${j + 1}: ${lines[j]}`);
				}

				if (results.length >= max_results) break;
			}

			let truncated = results.length >= max_results;
			let text = JSON.stringify(
				{
					query,
					matches,
					truncated,
					results,
				},
				null,
				2,
			);

			if (text.length > max_output_chars) {
				truncated = true;
				const cappedResults: string[] = [];
				let total = 0;
				for (const line of results) {
					const nextLen = total + line.length + 1;
					if (nextLen > max_output_chars) break;
					cappedResults.push(line);
					total = nextLen;
				}
				text = JSON.stringify(
					{
						query,
						matches,
						truncated,
						results: cappedResults,
					},
					null,
					2,
				);
			}
			return {
				content: [
					{
						type: "text",
						text,
					},
				],
			};
		} catch (error) {
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: `Failed to search schema: ${error}`,
					},
				],
			};
		}
	},
);

server.tool(
	"get-enum-values",
	"Return all values for a GraphQL enum by name. Use this instead of introspecting the full schema.",
	{
		enum_name: z.string().min(1),
	},
	async ({ enum_name }) => {
		try {
			const schema = await loadSchemaForSearch();
			const lines = schema.split(/\r?\n/);
			const target = `enum ${enum_name}`;
			let start = -1;
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].trim().startsWith(target)) {
					start = i;
					break;
				}
			}

			if (start === -1) {
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: `Enum not found: ${enum_name}`,
						},
					],
				};
			}

			const values: string[] = [];
			for (let i = start + 1; i < lines.length; i++) {
				const line = lines[i].trim();
				if (line.startsWith("}")) break;
				if (!line || line.startsWith("#")) continue;
				const val = line.split(/\s+/)[0];
				if (val) values.push(val);
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								enum: enum_name,
								values,
							},
							null,
							2,
						),
					},
				],
			};
		} catch (error) {
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: `Failed to read enum values: ${error}`,
					},
				],
			};
		}
	},
);

server.tool(
	"generate-query",
	"Generate a safe GraphQL query template for a given intent and parameters. Returns query + variables.",
	{
		intent: z.enum([
			"list_bookings",
			"booking_details",
			"list_users",
			"user_by_email",
			"list_resources",
			"resource_availability",
			"list_invoices",
			"invoice_details",
			"list_conversations",
		]),
		organization_id: z.string().optional(),
		user_id: z.string().optional(),
		email: z.string().optional(),
		location_id: z.string().optional(),
		resource_id: z.string().optional(),
		booking_id: z.string().optional(),
		invoice_id: z.string().optional(),
		client_id: z.string().optional(),
		start_timestamp: z.number().int().optional(),
		end_timestamp: z.number().int().optional(),
		limit: z.number().int().min(1).max(200).optional(),
		page: z.number().int().min(1).optional(),
	},
	async (args) => {
		const vars: Record<string, any> = {};
		const limit = args.limit ?? 50;
		const page = args.page ?? 1;

		switch (args.intent) {
			case "list_bookings": {
				vars.page = page;
				vars.limit = limit;
				if (args.user_id) vars.userId = args.user_id;
				if (args.location_id) vars.locationId = [args.location_id];
				if (args.resource_id) vars.resourceId = [args.resource_id];
				if (args.start_timestamp) vars.startFrom = args.start_timestamp;
				if (args.end_timestamp) vars.startTo = args.end_timestamp;
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									query: `query Bookings($page: Int = 1, $limit: Int = 50, $userId: ID, $locationId: [ID], $resourceId: [ID], $startFrom: Int, $startTo: Int) {\n  bookings(page: $page, limit: $limit, user_id: $userId, location_id: $locationId, resource_id: $resourceId, start_timestamp_from: $startFrom, start_timestamp_to: $startTo) {\n    total\n    data { booking_id title start_timestamp end_timestamp is_new is_approved is_canceled is_rejected resource { resource_id name } user { user_id fullname email } }\n  }\n}\n`,
									variables: vars,
								},
								null,
								2,
							),
						},
					],
				};
			}
			case "booking_details": {
				vars.bookingId = args.booking_id;
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									query: `query Booking($bookingId: ID!) {\n  booking(booking_id: $bookingId) { booking_id title start_timestamp end_timestamp notes resource { resource_id name } location { location_id name } account { account_id name } }\n}\n`,
									variables: vars,
								},
								null,
								2,
							),
						},
					],
				};
			}
			case "list_users": {
				vars.page = page;
				vars.limit = limit;
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									query: `query Users($page: Int = 1, $limit: Int = 50) {\n  users(page: $page, limit: $limit) { total data { user_id fullname email is_active is_lead } }\n}\n`,
									variables: vars,
								},
								null,
								2,
							),
						},
					],
				};
			}
			case "user_by_email": {
				vars.email = args.email;
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									query: `query UserByEmail($email: String!) {\n  user(get_by_email: $email) { user_id fullname email is_admin is_active }\n}\n`,
									variables: vars,
								},
								null,
								2,
							),
						},
					],
				};
			}
			case "list_resources": {
				vars.page = page;
				vars.limit = limit;
				if (args.location_id) vars.locationId = [args.location_id];
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									query: `query Resources($page: Int = 1, $limit: Int = 50, $locationId: [ID!]) {\n  resources(page: $page, limit: $limit, location_id: $locationId) { total data { resource_id name is_bookable capacity type { resource_type_id name } location { location_id name } } }\n}\n`,
									variables: vars,
								},
								null,
								2,
							),
						},
					],
				};
			}
			case "resource_availability": {
				vars.start = args.start_timestamp;
				vars.end = args.end_timestamp;
				if (args.location_id) vars.locationId = [args.location_id];
				if (args.resource_id) vars.resourceId = [args.resource_id];
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									query: `query ResourceAvailability($start: Int!, $end: Int!, $locationId: [ID!], $resourceId: [ID!]) {\n  resourceAvailability(input: { start_timestamp: $start, end_timestamp: $end, resource: { location_id: $locationId, resource_id: $resourceId } }) { resource_id score availability { start_timestamp end_timestamp } }\n}\n`,
									variables: vars,
								},
								null,
								2,
							),
						},
					],
				};
			}
			case "list_invoices": {
				vars.page = page;
				vars.limit = limit;
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									query: `query Invoices($page: Int = 1, $limit: Int = 50) {\n  invoices(page: $page, limit: $limit) { total data { invoice_id status due_timestamp total balance account { account_id name } } }\n}\n`,
									variables: vars,
								},
								null,
								2,
							),
						},
					],
				};
			}
			case "invoice_details": {
				vars.invoiceId = args.invoice_id;
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									query: `query Invoice($invoiceId: ID!) {\n  invoice(invoice_id: $invoiceId) { invoice_id status due_timestamp total balance items { item_id name quantity total } billing_details { name email address city country } }\n}\n`,
									variables: vars,
								},
								null,
								2,
							),
						},
					],
				};
			}
			case "list_conversations": {
				vars.orgId = args.organization_id ?? null;
				vars.limit = limit;
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									query: `query Conversations($orgId: ID, $limit: Int = 200) {\n  conversations(organization_id: $orgId, limit: $limit) { total data { conversation_id name conversation_type latest_message { message_id message timestamp } unread_message_count } }\n}\n`,
									variables: vars,
								},
								null,
								2,
							),
						},
					],
				};
			}
		}

		return {
			isError: true,
			content: [
				{
					type: "text",
					text: "Unsupported intent or missing required parameters.",
				},
			],
		};
	},
);

server.tool(
	"query-graphql",
	"Query a GraphQL endpoint with the given query and variables",
	{
		query: z.string(),
		variables: z.string().optional(),
	},
	async ({ query, variables }) => {
		try {
			const parsedQuery = parse(query);

			// Check if the query is a mutation
			const isMutation = parsedQuery.definitions.some(
				(def) =>
					def.kind === "OperationDefinition" && def.operation === "mutation",
			);

			if (isMutation && !env.ALLOW_MUTATIONS) {
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: "Mutations are not allowed unless you enable them in the configuration. Please use a query operation instead.",
						},
					],
				};
			}
		} catch (error) {
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: `Invalid GraphQL query: ${error}`,
					},
				],
			};
		}

		try {
			const response = await fetch(env.ENDPOINT, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...env.HEADERS,
				},
				body: JSON.stringify({
					query,
					variables,
				}),
			});

			if (!response.ok) {
				const responseText = await response.text();

				return {
					isError: true,
					content: [
						{
							type: "text",
							text: `GraphQL request failed: ${response.statusText}\n${responseText}`,
						},
					],
				};
			}

			const data = await response.json();

			if (data.errors && data.errors.length > 0) {
				// Contains GraphQL errors
				return {
					isError: true,
					content: [
						{
							type: "text",
							text: `The GraphQL response has errors, please fix the query: ${JSON.stringify(
								data,
								null,
								2,
							)}`,
						},
					],
				};
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(data, null, 2),
					},
				],
			};
		} catch (error) {
			throw new Error(`Failed to execute GraphQL query: ${error}`);
		}
	},
);

// ==================== Register Optix Business Tools ====================

if (IS_OPTIX) {
	console.error("Detected Optix API - enabling business tools");
	
	const optixTools = createOptixTools();
	
	// Register each Optix tool
	for (const [toolName, tool] of optixTools) {
		server.tool(
			toolName,
			tool.description,
			tool.inputSchema.shape, // Extract the shape from ZodObject
			async (args: any) => {
				try {
					const result = await tool.execute(args, env.ENDPOINT, env.HEADERS);
					return {
						content: [
							{
								type: "text" as const,
								text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
							},
						],
					};
				} catch (error: any) {
					return {
						isError: true,
						content: [
							{
								type: "text" as const,
								text: `Optix tool error: ${error.message}`,
							},
						],
					};
				}
			},
		);
	}
	
	console.error(`Registered ${optixTools.size} Optix business tools`);
}

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);

	console.error(
		`Started graphql mcp server ${env.NAME} for endpoint: ${env.ENDPOINT}`,
	);
	
	if (IS_OPTIX) {
		console.error("🎯 Optix business tools are active!");
		console.error("Available Optix tools:");
		console.error("  • optix_list_bookings - List and filter bookings");
		console.error("  • optix_check_availability - Check resource availability");
		console.error("  • optix_create_booking - Create new bookings");
		console.error("  • optix_list_members - Find and manage members");
		console.error("  • optix_list_resources - Browse meeting rooms and spaces");
		console.error("  • optix_get_booking_stats - Analytics and reports");
		console.error("  • And many more business-specific tools!");
	}
}

main().catch((error) => {
	console.error(`Fatal error in main(): ${error}`);
	process.exit(1);
});
