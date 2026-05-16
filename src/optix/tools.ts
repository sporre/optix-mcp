/**
 * Optix Business Tools
 * 
 * This module creates MCP tools specifically designed for Optix business operations.
 * These tools provide high-level business functionality that goes beyond basic GraphQL queries,
 * offering Claude intelligent ways to interact with Optix data.
 */

import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OPTIX_QUERIES, OPTIX_MUTATIONS } from "./queries.js";
import type {
	Booking,
	Member,
	Resource,
	PlanTemplate,
	Organization,
	BookingStats,
	MemberStats,
	ListBookingsArgs,
	ListMembersArgs,
	CheckAvailabilityArgs,
	BookingInput,
	CreateMemberResponse,
} from "./types.js";

/**
 * Tool definition interface
 */
interface OptixTool {
	name: string;
	description: string;
	inputSchema: z.ZodObject<any>; // Keep it as ZodObject and extract shape later
	execute: (args: any, endpoint: string, headers: Record<string, string>) => Promise<any>;
}

/**
 * Create a GraphQL request helper
 */
async function executeGraphQL(
	query: string,
	variables: any,
	endpoint: string,
	headers: Record<string, string>
): Promise<any> {
	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...headers,
		},
		body: JSON.stringify({
			query,
			variables,
		}),
	});

	if (!response.ok) {
		throw new Error(`GraphQL request failed: ${response.statusText}`);
	}

	const result = await response.json();

	if (result.errors && result.errors.length > 0) {
		throw new Error(`GraphQL errors: ${JSON.stringify(result.errors, null, 2)}`);
	}

	return result.data;
}

function resolveSchemaPath(): string | undefined {
	const envPath = process.env.SCHEMA;
	if (envPath && !envPath.startsWith("http")) {
		return envPath;
	}
	const currentDir = dirname(fileURLToPath(import.meta.url));
	const candidate = resolve(currentDir, "../schema.full.graphql");
	return existsSync(candidate) ? candidate : undefined;
}

function readSchemaText(): string {
	const schemaPath = resolveSchemaPath();
	if (!schemaPath || !existsSync(schemaPath)) {
		throw new Error("Local schema not found. Set SCHEMA to a local file path.");
	}
	return readFileSync(schemaPath, "utf8");
}

function getEnumValues(enumName: string): string[] {
	const schema = readSchemaText();
	const lines = schema.split(/\r?\n/);
	const target = `enum ${enumName}`;
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim().startsWith(target)) {
			start = i;
			break;
		}
	}
	if (start === -1) return [];
	const values: string[] = [];
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line.startsWith("}")) break;
		if (!line || line.startsWith("#")) continue;
		const val = line.split(/\s+/)[0];
		if (val) values.push(val);
	}
	return values;
}

function resolveWorkflowsConfigPath(): string | undefined {
	const direct = process.env.WORKFLOWS_CONFIG_PATH;
	if (direct && existsSync(direct)) return direct;
	const base = process.env.OPTIX_CODEBASE_PATH;
	if (base) {
		const candidate = resolve(base, "api-v2/config/workflows.php");
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

type WorkflowMappings = {
	triggerVariables: Record<string, string[]>;
	triggerOps: Record<string, string[]>;
	triggerActions: Record<string, string[]>;
	recipes: {
		name?: string;
		recipe_type?: string;
		trigger_type?: string;
		actions: string[];
		conditions_logic?: "AND" | "OR" | "SINGLE" | "NONE";
		conditions: {
			operation?: string;
			operands?: {
				type: "variable" | "value";
				name?: string;
				value?: string;
				date_modifier?: {
					value: string;
					unit: string;
				};
			}[];
		}[];
		conditions_groups?: {
			conditions: {
				operation?: string;
				operands?: {
					type: "variable" | "value";
					name?: string;
					value?: string;
					date_modifier?: {
						value: string;
						unit: string;
					};
				}[];
			}[];
		}[];
	}[];
};

function parseWorkflowConfig(): WorkflowMappings | null {
	const envPath = process.env.AUTOMATION_RULES_PATH;
	const currentDir = dirname(fileURLToPath(import.meta.url));
	const defaultPath = resolve(currentDir, "../../automation-mapping.json");
	const mappingPath = envPath && existsSync(envPath) ? envPath : defaultPath;
	if (!existsSync(mappingPath)) return null;

	const raw = readFileSync(mappingPath, "utf8");
	const parsed = JSON.parse(raw) as {
		rules?: {
			name?: string;
			trigger_type?: string;
			actions?: string[];
			conditions_logic?: "AND" | "OR" | "SINGLE" | "NONE";
			conditions?: {
				operation?: string;
				operands?: {
					type: "variable" | "value";
					name?: string;
					value?: string;
					date_modifier?: { value: string; unit: string };
				}[];
			}[];
			conditions_groups?: {
				conditions: {
					operation?: string;
					operands?: {
						type: "variable" | "value";
						name?: string;
						value?: string;
						date_modifier?: { value: string; unit: string };
					}[];
				}[];
			}[];
		}[];
		triggers?: {
			trigger_type?: string;
			rules?: {
				name?: string;
				trigger_type?: string;
				actions?: string[];
				conditions_logic?: "AND" | "OR" | "SINGLE" | "NONE";
				conditions?: {
					operation?: string;
					operands?: {
						type: "variable" | "value";
						name?: string;
						value?: string;
						date_modifier?: { value: string; unit: string };
					}[];
				}[];
				conditions_groups?: {
					conditions: {
						operation?: string;
						operands?: {
							type: "variable" | "value";
							name?: string;
							value?: string;
							date_modifier?: { value: string; unit: string };
						}[];
					}[];
				}[];
			}[];
		}[];
	};

	const triggerVariables: Record<string, Set<string>> = {};
	const triggerOps: Record<string, Set<string>> = {};
	const triggerActions: Record<string, Set<string>> = {};
	const recipes: WorkflowMappings["recipes"] = [];

	const rules =
		parsed.triggers?.flatMap((group) =>
			(group.rules ?? []).map((rule) => ({
				...rule,
				trigger_type: rule.trigger_type ?? group.trigger_type,
			})),
		) ?? parsed.rules ?? [];

	for (const rule of rules) {
		const trigger = rule.trigger_type;
		const actions = rule.actions ?? [];
		const conditions = rule.conditions ?? [];
		const conditionsGroups = rule.conditions_groups ?? [];
		const allConditions = [
			...conditions,
			...conditionsGroups.flatMap((group) => group.conditions ?? []),
		];
		if (trigger) {
			if (!triggerVariables[trigger]) triggerVariables[trigger] = new Set();
			if (!triggerOps[trigger]) triggerOps[trigger] = new Set();
			if (!triggerActions[trigger]) triggerActions[trigger] = new Set();

			for (const condition of allConditions) {
				if (condition.operation) {
					triggerOps[trigger].add(condition.operation);
				}
				for (const operand of condition.operands ?? []) {
					if (operand.type === "variable" && operand.name) {
						triggerVariables[trigger].add(operand.name);
					}
				}
			}
			for (const action of actions) {
				triggerActions[trigger].add(action);
			}
		}

		recipes.push({
			name: rule.name,
			trigger_type: trigger,
			actions: actions,
			conditions_logic: rule.conditions_logic,
			conditions: conditions,
			conditions_groups: conditionsGroups,
		});
	}

	const toList = (obj: Record<string, Set<string>>) =>
		Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Array.from(v)]));

	return {
		triggerVariables: toList(triggerVariables),
		triggerOps: toList(triggerOps),
		triggerActions: toList(triggerActions),
		recipes,
	};
}

/**
 * Create all Optix business tools
 */
export function createOptixTools(): Map<string, OptixTool> {
	const tools = new Map<string, OptixTool>();
	
	// Check if mutations are allowed via environment variable
	const allowMutations = process.env.ALLOW_MUTATIONS === "true";
	const automationLogicExplain =
		"Conditions use AND by default unless grouped. Use conditions_groups: each group is AND; groups are OR. If no groups, treat conditions as AND.";

	// ==================== Booking Management Tools ====================

	tools.set("optix_list_bookings", {
		name: "optix_list_bookings",
		description: "List bookings in your Optix workspace. Perfect for checking daily schedules, finding specific bookings, or getting an overview of space usage. You can filter by date range, status, member, or resource.",
		inputSchema: z.object({
			from: z.string().optional().describe("Start date/time in ISO 8601 format (e.g., '2025-09-29T00:00:00Z'). If not provided, shows bookings from today."),
			to: z.string().optional().describe("End date/time in ISO 8601 format. If not provided, shows bookings for the next 7 days."),
			status: z.enum(["pending", "confirmed", "cancelled", "completed", "no_show"]).optional().describe("Filter by booking status"),
			limit: z.number().min(1).max(100).default(50).describe("Maximum number of results to return"),
			memberId: z.string().optional().describe("Filter bookings for a specific member"),
			resourceId: z.string().optional().describe("Filter bookings for a specific resource/space"),
		}),
		execute: async (args, endpoint, headers) => {
			const data = await executeGraphQL(OPTIX_QUERIES.LIST_BOOKINGS, args, endpoint, headers);
			const bookings = data.bookings.data || [];
			return {
				bookings: bookings,
				total: data.bookings.total || bookings.length,
				summary: {
					returned: bookings.length,
					total: data.bookings.total || bookings.length,
					byStatus: bookings.reduce((acc: any, booking: any) => {
						acc[booking.status] = (acc[booking.status] || 0) + 1;
						return acc;
					}, {}),
				},
			};
		},
	});

	tools.set("optix_get_booking_details", {
		name: "optix_get_booking_details",
		description: "Get comprehensive details about a specific booking, including member information, resource details, and booking history.",
		inputSchema: z.object({
			id: z.string().describe("The booking ID"),
		}),
		execute: async (args, endpoint, headers) => {
			const variables = { booking_id: args.id };
			const data = await executeGraphQL(OPTIX_QUERIES.GET_BOOKING, variables, endpoint, headers);
			return data.booking;
		},
	});

	tools.set("optix_check_availability", {
		name: "optix_check_availability",
		description: "Check if a resource (meeting room, desk, etc.) is available for a specific time period. Shows any conflicting bookings and suggests alternative times if needed. If start/end not provided, checks next 7 days.",
		inputSchema: z.object({
			resourceId: z.string().describe("The resource/space ID to check"),
			start: z.string().optional().describe("Start time in ISO 8601 format (e.g., '2025-09-29T14:00:00Z'). Defaults to now."),
			end: z.string().optional().describe("End time in ISO 8601 format (e.g., '2025-09-29T16:00:00Z'). Defaults to 7 days from start."),
		}),
		execute: async (args, endpoint, headers) => {
			// Use defaults if start/end not provided
			const now = new Date();
			const startDate = args.start ? new Date(args.start) : now;
			const endDate = args.end ? new Date(args.end) : new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

			// Convert ISO dates to Unix timestamps and resourceId to array
			const variables = {
				resource_id: [args.resourceId],
				start_timestamp: Math.floor(startDate.getTime() / 1000),
				end_timestamp: Math.floor(endDate.getTime() / 1000),
			};

			const data = await executeGraphQL(OPTIX_QUERIES.CHECK_AVAILABILITY, variables, endpoint, headers);
			const resources = data.resources?.data || [];
			const bookings = data.bookings?.data || [];

			const resource = resources[0];
			const conflictingBookings = bookings.filter((b: any) =>
				b.is_approved && !b.is_canceled && !b.is_rejected
			);

			return {
				resource: resource ? {
					id: resource.resource_id,
					name: resource.name || resource.title,
					isBookable: resource.is_bookable,
				} : null,
				timeSlot: {
					start: startDate.toISOString(),
					end: endDate.toISOString(),
					duration: `${Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))} days`,
				},
				available: conflictingBookings.length === 0,
				conflicts: conflictingBookings.map((b: any) => ({
					booking_id: b.booking_id,
					start_timestamp: b.start_timestamp,
					end_timestamp: b.end_timestamp,
				})),
				totalConflicts: conflictingBookings.length,
				recommendation: conflictingBookings.length === 0
					? "✅ Resource is available for the requested time"
					: `❌ Resource is not available. ${conflictingBookings.length} conflicting booking(s) found.`,
			};
		},
	});

	// ==================== Automation / Workflow Tools ====================

	tools.set("optix_list_automation_triggers", {
		name: "optix_list_automation_triggers",
		description: "List all automation trigger types.",
		inputSchema: z.object({}),
		execute: async () => {
			const triggers = getEnumValues("WorkflowTriggerType");
			return { triggers };
		},
	});

	tools.set("optix_list_automation_actions", {
		name: "optix_list_automation_actions",
		description: "List automation actions. Optionally filter by trigger_type if mappings are available.",
		inputSchema: z.object({
			trigger_type: z.string().optional().describe("Optional trigger type to filter actions"),
		}),
		execute: async (args) => {
			const allActions = getEnumValues("WorkflowActionType");
			const mappings = parseWorkflowConfig();
			if (args.trigger_type && mappings?.triggerActions?.[args.trigger_type]) {
				return {
					trigger_type: args.trigger_type,
					actions: mappings.triggerActions[args.trigger_type],
					note: "Filtered by automation-mapping.json rules",
				};
			}
			return { actions: allActions };
		},
	});

	tools.set("optix_list_automation_conditions", {
		name: "optix_list_automation_conditions",
		description: "List automation condition operations and variables. Optionally filter by trigger_type if mappings are available.",
		inputSchema: z.object({
			trigger_type: z.string().optional().describe("Optional trigger type to filter variables/operations"),
		}),
		execute: async (args) => {
			const operations = getEnumValues("ConditionOperation");
			const variables = getEnumValues("EvaluableVariable");
			const mappings = parseWorkflowConfig();
			if (args.trigger_type && mappings?.triggerVariables?.[args.trigger_type]) {
				return {
					trigger_type: args.trigger_type,
					operations: mappings.triggerOps[args.trigger_type] ?? [],
					variables: mappings.triggerVariables[args.trigger_type] ?? [],
					note: "Filtered by automation-mapping.json rules",
				};
			}
			return { operations, variables };
		},
	});

	tools.set("optix_automation_rules", {
		name: "optix_automation_rules",
		description: "List automation recipes (rules) with trigger and action summary.",
		inputSchema: z.object({}),
		execute: async () => {
			const mappings = parseWorkflowConfig();
			if (!mappings) {
				throw new Error("AUTOMATION_RULES_PATH not set and automation-mapping.json not found.");
			}
			return { recipes: mappings.recipes, logic_explain: automationLogicExplain };
		},
	});

	tools.set("optix_automation_dryrun", {
		name: "optix_automation_dryrun",
		description: "Simulate which actions/conditions apply for a given trigger type (rule-based only).",
		inputSchema: z.object({
			trigger_type: z.string().describe("Trigger type to simulate"),
		}),
		execute: async (args) => {
			const mappings = parseWorkflowConfig();
			if (!mappings) {
				throw new Error("AUTOMATION_RULES_PATH not set and automation-mapping.json not found.");
			}
			return {
				trigger_type: args.trigger_type,
				actions: mappings.triggerActions[args.trigger_type] ?? [],
				operations: mappings.triggerOps[args.trigger_type] ?? [],
				variables: mappings.triggerVariables[args.trigger_type] ?? [],
				note: "Rule-based mapping from automation-mapping.json; no user-level evaluation performed.",
				logic_explain: automationLogicExplain,
			};
		},
	});

	// ==================== Mutation Tools (conditionally enabled) ====================
	
	if (allowMutations) {
		tools.set("optix_create_booking", {
			name: "optix_create_booking",
			description: "Create a new booking for a member. This will reserve a resource for the specified time period.",
			inputSchema: z.object({
				accountId: z.string().describe("The account ID making the booking"),
				resourceId: z.string().describe("The resource/space ID to book"),
				start: z.string().describe("Booking start time in ISO 8601 format (e.g., '2025-10-06T14:00:00Z')"),
				end: z.string().describe("Booking end time in ISO 8601 format (e.g., '2025-10-06T16:00:00Z')"),
				title: z.string().optional().describe("Optional booking title"),
				notes: z.string().optional().describe("Optional notes for the booking"),
			}),
			execute: async (args, endpoint, headers) => {
				// Check if CREATE_BOOKING mutation is defined
				if (!OPTIX_MUTATIONS.CREATE_BOOKING) {
					throw new Error("CREATE_BOOKING mutation is not defined. Please add the mutation schema to OPTIX_MUTATIONS in queries.ts");
				}

				// Convert ISO dates to Unix timestamps
				const startTimestamp = Math.floor(new Date(args.start).getTime() / 1000);
				const endTimestamp = Math.floor(new Date(args.end).getTime() / 1000);

				// Build Optix API BookingSetInput format
				const input = {
					account: {
						account_id: args.accountId
					},
					title: args.title || "",
					notes: args.notes || "",
					bookings: [{
						resource_id: [args.resourceId],
						start_timestamp: startTimestamp,
						end_timestamp: endTimestamp,
					}]
				};

				const data = await executeGraphQL(OPTIX_MUTATIONS.CREATE_BOOKING, { input }, endpoint, headers);
				const response = data.bookingsCommit;

				const booking = response.bookings?.[0];

				if (!booking) {
					throw new Error("Booking creation failed: No booking returned");
				}

				return {
					booking: booking,
					account: response.account,
					booking_session_id: response.booking_session_id,
					status: booking.is_confirmed
						? "✅ Booking confirmed!"
						: "⏳ Booking created and may require approval",
				};
			},
		});

		tools.set("optix_cancel_booking", {
			name: "optix_cancel_booking",
			description: "Cancel an existing booking. This will free up the resource for other members to book.",
			inputSchema: z.object({
				bookingId: z.string().describe("The booking ID to cancel"),
			}),
			execute: async (args, endpoint, headers) => {
				// Check if CANCEL_BOOKING mutation is defined
				if (!OPTIX_MUTATIONS.CANCEL_BOOKING) {
					throw new Error("CANCEL_BOOKING mutation is not defined. Please add the mutation schema to OPTIX_MUTATIONS in queries.ts");
				}

				const data = await executeGraphQL(OPTIX_MUTATIONS.CANCEL_BOOKING, { booking_id: args.bookingId }, endpoint, headers);
				const response = data.bookingsCommit;

				const booking = response.bookings?.[0];

				if (!booking) {
					throw new Error("Cancellation failed: No booking returned");
				}

				return {
					success: true,
					booking: booking,
					message: booking.is_canceled ? "✅ Booking cancelled successfully" : "⚠️ Booking cancellation status unclear",
				};
			},
		});

		tools.set("optix_create_member", {
			name: "optix_create_member",
			description: "Create a new member/user in your Optix workspace. The email must be unique. Optionally mark as lead for sales follow-up.",
			inputSchema: z.object({
				email: z.string().email().describe("Email address (required, must be unique)"),
				name: z.string().optional().describe("First name of the new member"),
				surname: z.string().optional().describe("Last name/surname of the new member"),
				phone: z.string().optional().describe("Phone number"),
				notify_user_by_email: z.boolean().optional().describe("Send welcome email to user (default: false)"),
				primary_location_id: z.string().optional().describe("Primary location ID to assign the member to"),
				is_lead: z.boolean().optional().describe("Mark as lead for sales follow-up (default: false)"),
			}),
			execute: async (args, endpoint, headers) => {
				// Check if CREATE_MEMBER mutation is defined
				if (!OPTIX_MUTATIONS.CREATE_MEMBER) {
					throw new Error("CREATE_MEMBER mutation is not defined. Please add the mutation schema to OPTIX_MUTATIONS in queries.ts");
				}

				const variables = {
					email: args.email,
					name: args.name,
					surname: args.surname,
					phone: args.phone,
					notify_user_by_email: args.notify_user_by_email,
					primary_location_id: args.primary_location_id,
					is_lead: args.is_lead,
				};

				const data = await executeGraphQL(OPTIX_MUTATIONS.CREATE_MEMBER, variables, endpoint, headers);
				const user = data.userCreate;

				if (!user || !user.user_id) {
					throw new Error("Member creation failed: No user returned");
				}

				return {
					success: true,
					user: {
						user_id: user.user_id,
						email: user.email,
						name: user.name,
						surname: user.surname,
						fullname: user.fullname,
						phone: user.phone,
						is_active: user.is_active,
						is_lead: user.is_lead,
						is_pending: user.is_pending,
						user_since: user.user_since,
					},
					message: user.is_lead
						? "✅ Lead created successfully! Follow up to convert to member."
						: "✅ Member created successfully!",
				};
			},
		});

		tools.set("optix_update_booking", {
			name: "optix_update_booking",
			description: "Update an existing booking's time, resource, or other details. Can reschedule or modify booking information.",
			inputSchema: z.object({
				bookingId: z.string().describe("The booking ID to update"),
				start: z.string().optional().describe("New start time in ISO 8601 format"),
				end: z.string().optional().describe("New end time in ISO 8601 format"),
				resourceId: z.string().optional().describe("New resource/space ID (for moving booking)"),
				title: z.string().optional().describe("Updated title"),
				notes: z.string().optional().describe("Updated notes"),
			}),
			execute: async (args, endpoint, headers) => {
				if (!OPTIX_MUTATIONS.UPDATE_BOOKING) {
					throw new Error("UPDATE_BOOKING mutation is not defined. Please add the mutation schema to OPTIX_MUTATIONS in queries.ts");
				}

				// Build booking update object
				const bookingUpdate: any = {
					booking_id: args.bookingId,
				};

				if (args.start) {
					bookingUpdate.start_timestamp = Math.floor(new Date(args.start).getTime() / 1000);
				}
				if (args.end) {
					bookingUpdate.end_timestamp = Math.floor(new Date(args.end).getTime() / 1000);
				}
				if (args.resourceId) {
					bookingUpdate.resource_id = [args.resourceId];
				}

				const input = {
					title: args.title || "",
					notes: args.notes || "",
					bookings: [bookingUpdate],
				};

				const data = await executeGraphQL(OPTIX_MUTATIONS.UPDATE_BOOKING, { input }, endpoint, headers);
				const response = data.bookingsCommit;
				const booking = response.bookings?.[0];

				if (!booking) {
					throw new Error("Booking update failed: No booking returned");
				}

				return {
					success: true,
					booking: booking,
					message: "✅ Booking updated successfully!",
				};
			},
		});
	}

	tools.set("optix_get_upcoming_schedule", {
		name: "optix_get_upcoming_schedule",
		description: "Get upcoming schedule events including bookings, assignments, availability blocks, and tours. Perfect for viewing complete daily schedules and planning. Returns all active and upcoming events.",
		inputSchema: z.object({
			days: z.number().min(1).max(365).default(7).describe("Number of days to look ahead (1-365)"),
		}),
		execute: async (args, endpoint, headers) => {
			const now = Math.floor(Date.now() / 1000);
			const daysInSeconds = (args.days || 7) * 24 * 60 * 60;
			const variables: any = {
				limit: 100,
				end_timestamp_from: now, // Include events that haven't ended yet (including ongoing assignments with no end date)
				start_timestamp_to: now + daysInSeconds, // And start before the end of our time range
				status: ["ACTIVE", "UPCOMING"], // Only return active and upcoming events, exclude CANCELED and ENDED
			};

			const data = await executeGraphQL(OPTIX_QUERIES.GET_UPCOMING_SCHEDULE, variables, endpoint, headers);
			const events = data.schedule?.data || [];

			const next24Hours = now + 24 * 60 * 60;

			return {
				events,
				summary: {
					total: events.length,
					next24Hours: events.filter((e: any) =>
						e.start_timestamp >= now && e.start_timestamp <= next24Hours
					).length,
					daysAhead: args.days,
					byType: events.reduce((acc: any, e: any) => {
						acc[e.type] = (acc[e.type] || 0) + 1;
						return acc;
					}, {}),
				},
			};
		},
	});

	// ==================== Member Management Tools ====================

	tools.set("optix_list_members", {
		name: "optix_list_members",
		description: "List members in your Optix workspace. You can search by name/email, filter by status, or browse all members with pagination. Note: a Member can belong to a Team. When attributing revenue/MRR, plans paid by a Team should be attributed to the Team account, not the individual Member.",
		inputSchema: z.object({
			search: z.string().optional().describe("Search by member name or email address"),
			status: z.enum(["active", "inactive", "pending", "suspended"]).optional().describe("Filter by member status"),
			limit: z.number().min(1).max(100).default(50).describe("Maximum number of results"),
			offset: z.number().min(0).default(0).describe("Number of results to skip (for pagination)"),
			organizationId: z.string().optional().describe("Filter by organization/company"),
		}),
		execute: async (args, endpoint, headers) => {
			const data = await executeGraphQL(OPTIX_QUERIES.LIST_MEMBERS, args, endpoint, headers);
			const members = data.accounts?.data || data.members?.data || [];

			return {
				members,
				total: data.accounts?.total || data.members?.total || members.length,
				pagination: {
					returned: members.length,
					total: data.accounts?.total || data.members?.total || members.length,
					offset: args.offset || 0,
					hasMore: members.length === (args.limit || 50),
				},
				summary: {
					byStatus: members.reduce((acc: any, member: Member) => {
						acc[member.status] = (acc[member.status] || 0) + 1;
						return acc;
					}, {}),
				},
			};
		},
	});

	tools.set("optix_list_newest_members", {
		name: "optix_list_newest_members",
		description: "List the newest members in your Optix workspace, sorted by creation date (most recent first). Use this to see recently joined members. Note: if a Member belongs to a Team, any MRR they bring in should be attributed to the Team account, not the individual.",
		inputSchema: z.object({
			limit: z.number().min(1).max(100).default(10).describe("Maximum number of newest members to return"),
			page: z.number().min(1).default(1).describe("Page number for pagination"),
		}),
		execute: async (args, endpoint, headers) => {
			const data = await executeGraphQL(OPTIX_QUERIES.LIST_NEWEST_MEMBERS, args, endpoint, headers);
			const members = data.accounts?.data || [];
			return {
				members,
				total: data.accounts?.total || members.length,
				pagination: {
					returned: members.length,
					total: data.accounts?.total || members.length,
					page: args.page || 1,
					limit: args.limit || 10,
					hasMore: members.length === (args.limit || 10),
				},
			};
		},
	});

	tools.set("optix_get_member_profile", {
		name: "optix_get_member_profile",
		description: "Get comprehensive member profile including contact details, professional info, location, social media, billing settings, and account status.",
		inputSchema: z.object({
			id: z.string().describe("The member ID"),
		}),
		execute: async (args, endpoint, headers) => {
			const variables = { account: { account_id: args.id } };
			const data = await executeGraphQL(OPTIX_QUERIES.GET_MEMBER, variables, endpoint, headers);
			return data.account;
		},
	});

	tools.set("optix_search_members", {
		name: "optix_search_members",
		description: "Smart search for members by name, email, or partial matches. Perfect for quickly finding a specific member when you don't have their exact ID.",
		inputSchema: z.object({
			query: z.string().describe("Search term - can be partial name, email, or phone number"),
			limit: z.number().min(1).max(50).default(20).describe("Maximum number of results"),
		}),
		execute: async (args, endpoint, headers) => {
			// Map 'query' to 'search' for the GraphQL query
			const variables = {
				search: args.query,
				limit: args.limit,
			};
			const data = await executeGraphQL(OPTIX_QUERIES.SEARCH_MEMBERS, variables, endpoint, headers);
			const members = data.accounts?.data || [];
			return {
				members,
				searchTerm: args.query,
				total: data.accounts?.total || members.length,
				resultCount: members.length,
			};
		},
	});

	// ==================== Resource Management Tools ====================

	tools.set("optix_list_resources", {
		name: "optix_list_resources",
		description: "List all available resources (meeting rooms, desks, offices) in your workspace. Filter by type, capacity, or availability.",
		inputSchema: z.object({
			type: z.enum(["meeting_room", "desk", "office", "phone_booth", "event_space", "locker", "parking", "other"]).optional().describe("Filter by resource type"),
			available: z.boolean().optional().describe("Only show currently available resources"),
			capacity: z.number().min(1).optional().describe("Minimum capacity required"),
			amenities: z.array(z.string()).optional().describe("Required amenities (e.g., ['projector', 'whiteboard'])"),
		}),
		execute: async (args, endpoint, headers) => {
			const data = await executeGraphQL(OPTIX_QUERIES.LIST_RESOURCES, args, endpoint, headers);
			const resources = data.resources?.data || [];

			return {
				resources,
				total: data.resources?.total || resources.length,
				summary: {
					returned: resources.length,
					total: data.resources?.total || resources.length,
					byType: resources.reduce((acc: any, resource: any) => {
						const type = resource.resource_type?.name || resource.type || 'unknown';
						acc[type] = (acc[type] || 0) + 1;
						return acc;
					}, {}),
					averageCapacity: resources.length > 0 ? Math.round(
						resources.reduce((sum: number, r: any) => sum + (r.capacity || 0), 0) / resources.length
					) : 0,
				},
			};
		},
	});

	tools.set("optix_get_resource_details", {
		name: "optix_get_resource_details",
		description: "Get comprehensive details about a specific resource, including booking rules, amenities, upcoming bookings, and availability patterns.",
		inputSchema: z.object({
			id: z.string().describe("The resource ID"),
		}),
		execute: async (args, endpoint, headers) => {
			const variables = { resource_id: args.id };
			const data = await executeGraphQL(OPTIX_QUERIES.GET_RESOURCE, variables, endpoint, headers);
			const resource = data.resource;

			return {
				...resource,
				utilizationInsights: {
					upcomingBookingsCount: resource.upcomingBookings?.length || 0,
					hasBookingsToday: resource.upcomingBookings?.some((b: Booking) => {
						const bookingDate = new Date(b.start).toDateString();
						const today = new Date().toDateString();
						return bookingDate === today;
					}) || false,
				},
			};
		},
	});

	tools.set("optix_get_resource_schedule", {
		name: "optix_get_resource_schedule",
		description: "Get a detailed schedule for a resource showing all time slots and their availability over a date range. Defaults to next 7 days if no dates provided.",
		inputSchema: z.object({
			resourceId: z.string().describe("The resource ID"),
			from: z.string().optional().describe("Start date in ISO 8601 format (defaults to today)"),
			to: z.string().optional().describe("End date in ISO 8601 format (defaults to 7 days from start)"),
		}),
		execute: async (args, endpoint, headers) => {
			// Default to today if from is not provided
			const now = new Date();
			const defaultFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
			const fromDate = args.from ? new Date(args.from) : defaultFrom;

			// Default to 7 days after fromDate if to is not provided
			const defaultTo = new Date(fromDate);
			defaultTo.setDate(defaultTo.getDate() + 7);
			const toDate = args.to ? new Date(args.to) : defaultTo;

			if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
				throw new Error("Invalid date format. Please use ISO 8601 format (e.g., '2025-10-04T00:00:00Z')");
			}

			const variables = {
				resource_id: args.resourceId,
				start_timestamp_from: Math.floor(fromDate.getTime() / 1000),
				start_timestamp_to: Math.floor(toDate.getTime() / 1000),
			};
			const data = await executeGraphQL(OPTIX_QUERIES.GET_RESOURCE_SCHEDULE, variables, endpoint, headers);
			const bookings = data.bookings?.data || [];
			const schedule = data.schedule?.data || [];

			return {
				resourceId: args.resourceId,
				dateRange: {
					from: fromDate.toISOString(),
					to: toDate.toISOString(),
				},
				bookings,
				schedule,
				summary: {
					totalBookings: bookings.length,
					approvedBookings: bookings.filter((b: any) => b.is_approved && !b.is_canceled).length,
					scheduleEvents: schedule.length,
				},
			};
		},
	});

	// ==================== Plan Template Management Tools ====================

	tools.set("optix_list_plan_templates", {
		name: "optix_list_plan_templates",
		description: "List all membership plan templates (pricing plans) available in your workspace. These define the different membership tiers and their features. Each plan has a price_frequency (e.g. WEEKLY, MONTHLY) which must be normalized to a monthly value before reporting MRR (WEEKLY * 4.34, DAILY * 30.42, ANNUAL / 12, etc.).",
		inputSchema: z.object({
			active: z.boolean().default(true).describe("Filter by active status"),
			category: z.string().optional().describe("Filter by plan category (e.g., 'premium', 'basic', 'corporate')"),
		}),
		execute: async (args, endpoint, headers) => {
			const data = await executeGraphQL(OPTIX_QUERIES.LIST_PLAN_TEMPLATES, args, endpoint, headers);
			const plans = data.planTemplates?.data || [];

			return {
				planTemplates: plans,
				total: data.planTemplates?.total || plans.length,
				summary: {
					returned: plans.length,
					total: data.planTemplates?.total || plans.length,
					priceRange: plans.length > 0 ? {
						min: Math.min(...plans.map((p: any) => p.price || 0)),
						max: Math.max(...plans.map((p: any) => p.price || 0)),
					} : null,
					byFrequency: plans.reduce((acc: any, plan: any) => {
						const freq = plan.price_frequency || 'unknown';
						acc[freq] = (acc[freq] || 0) + 1;
						return acc;
					}, {}),
				},
			};
		},
	});

	tools.set("optix_get_plan_template", {
		name: "optix_get_plan_template",
		description: "Get detailed information about a specific membership plan template, including features, pricing, and restrictions. Remember to normalize the price by price_frequency when reporting MRR (e.g. WEEKLY price * 4.34).",
		inputSchema: z.object({
			id: z.string().describe("The plan template ID"),
		}),
		execute: async (args, endpoint, headers) => {
			const variables = { plan_template_id: args.id };
			const data = await executeGraphQL(OPTIX_QUERIES.GET_PLAN_TEMPLATE, variables, endpoint, headers);
			return data.planTemplate;
		},
	});

	// ==================== Organization & Settings Tools ====================

	tools.set("optix_get_organization_info", {
		name: "optix_get_organization_info",
		description: "Get comprehensive information about your Optix organization, including settings, business hours, booking rules, and subscription details.",
		inputSchema: z.object({}),
		execute: async (args, endpoint, headers) => {
			const data = await executeGraphQL(OPTIX_QUERIES.GET_ORGANIZATION_INFO, {}, endpoint, headers);
			const me = data.me;

			return {
				authType: me.authType,
				user: me.user,
				organization: me.organization,
				currentTime: me.organization?.timezone
					? new Date().toLocaleString("en-US", { timeZone: me.organization.timezone })
					: new Date().toLocaleString(),
			};
		},
	});

	// ==================== Statistics & Reporting Tools ====================

	tools.set("optix_get_booking_stats", {
		name: "optix_get_booking_stats",
		description: "Get comprehensive booking statistics and analytics for a date range. Perfect for understanding space utilization and revenue patterns.",
		inputSchema: z.object({
			from: z.string().describe("Start date in ISO 8601 format"),
			to: z.string().describe("End date in ISO 8601 format"),
			resourceIds: z.array(z.string()).optional().describe("Filter stats for specific resources"),
			memberIds: z.array(z.string()).optional().describe("Filter stats for specific members"),
		}),
		execute: async (args, endpoint, headers) => {
			// Convert ISO dates to Unix timestamps
			const variables = {
				start_timestamp_from: Math.floor(new Date(args.from).getTime() / 1000),
				start_timestamp_to: Math.floor(new Date(args.to).getTime() / 1000),
			};

			const data = await executeGraphQL(OPTIX_QUERIES.GET_BOOKING_STATS, variables, endpoint, headers);
			const bookings = data.bookings?.data || [];
			const total = data.bookings?.total || bookings.length;

			// Calculate statistics
			const approvedBookings = bookings.filter((b: any) => b.is_approved && !b.is_canceled).length;
			const canceledBookings = bookings.filter((b: any) => b.is_canceled).length;
			const totalRevenue = bookings.reduce((sum: number, b: any) =>
				sum + (b.cost?.total_amount || 0), 0
			);

			return {
				totalBookings: total,
				returned: bookings.length,
				approvedBookings,
				canceledBookings,
				totalRevenue,
				insights: {
					cancellationRate: total > 0 ? Math.round((canceledBookings / total) * 100) : 0,
					averageRevenuePerBooking: approvedBookings > 0
						? Math.round((totalRevenue / approvedBookings) * 100) / 100
						: 0,
				},
			};
		},
	});

	tools.set("optix_get_member_stats", {
		name: "optix_get_member_stats",
		description: "Get account statistics including all account types (Member, Team, etc.) with status and type breakdowns.",
		inputSchema: z.object({}),
		execute: async (args, endpoint, headers) => {
			const data = await executeGraphQL(OPTIX_QUERIES.GET_MEMBER_STATS, {}, endpoint, headers);
			const accounts = data.accounts?.data || [];
			const total = data.accounts?.total || accounts.length;

			// Calculate stats from all accounts
			const activeAccounts = accounts.filter((a: any) => a.status === 'ACTIVE').length;
			const statusBreakdown = accounts.reduce((acc: any, a: any) => {
				acc[a.status] = (acc[a.status] || 0) + 1;
				return acc;
			}, {});
			const typeBreakdown = accounts.reduce((acc: any, a: any) => {
				acc[a.type] = (acc[a.type] || 0) + 1;
				return acc;
			}, {});

			return {
				totalAccounts: total,
				activeAccounts,
				returned: accounts.length,
				statusBreakdown,
				typeBreakdown,
				insights: {
					activePercentage: total > 0 ? Math.round((activeAccounts / total) * 100) : 0,
					totalReturned: accounts.length,
				},
			};
		},
	});

	return tools;
}
