/**
 * Optix GraphQL Query Templates
 * 
 * Query templates updated based on real Optix API Schema
 * Schema source: https://api.optixapp.com/graphql
 */

export const OPTIX_QUERIES = {
	// ==================== Organization & User Information ====================
	
	GET_ORGANIZATION_INFO: `
		query GetOrganizationInfo {
			me {
				authType
				user {
					user_id
					name
					email
					fullname
					surname
				}
				organization {
					organization_id
					name
					subdomain
					timezone
					currency
					address
					city
					country
				}
			}
		}
	`,

	LIST_ACCOUNTS: `
		query ListAccounts(
			$limit: Int = 100
			$page: Int = 1
			$search: String
			$search_by_name: String
			$search_by_email: String
			$type: [String!]
		) {
			accounts(
				limit: $limit
				page: $page
				search: $search
				search_by_name: $search_by_name
				search_by_email: $search_by_email
				type: $type
			) {
				data {
					account_id
					name
					type
					email
					phone
					status
					created_timestamp
					primary_location {
						location_id
						name
					}
				}
				total
			}
		}
	`,

	LIST_LOCATIONS: `
		query ListLocations(
			$limit: Int = 100
			$page: Int = 1
			$name: String
			$include_visible: Boolean
			$include_hidden: Boolean
		) {
			locations(
				limit: $limit
				page: $page
				name: $name
				include_visible: $include_visible
				include_hidden: $include_hidden
			) {
				data {
					location_id
					name
					address
					phone
					timezone
					currency
					status
					is_primary
				}
				total
			}
		}
	`,

	LIST_RESOURCES: `
		query ListResources(
			$limit: Int = 100
			$page: Int = 1
			$location_id: [ID!]
			$name: String
			$is_bookable: Boolean
			$resource_type_id: [ID!]
		) {
			resources(
				limit: $limit
				page: $page
				location_id: $location_id
				name: $name
				is_bookable: $is_bookable
				resource_type_id: $resource_type_id
			) {
				data {
					resource_id
					name
					title
					description
					capacity
					is_bookable
					is_assignable
					type {
						resource_type_id
						name
						booking_experience
					}
					location {
						location_id
						name
					}
				}
				total
			}
		}
	`,

	LIST_PLAN_TEMPLATES: `
		query ListPlanTemplates(
			$limit: Int = 100
			$page: Int = 1
			$name: String
			$location_id: [ID!]
		) {
			planTemplates(
				limit: $limit
				page: $page
				name: $name
				location_id: $location_id
			) {
				data {
					plan_template_id
					name
					description
					price_frequency
					allowance_renewal_frequency
					price
					deposit
					set_up_fee
					in_all_locations
					locations {
						location_id
						name
					}
				}
				total
			}
		}
	`,

	// ==================== Booking Related Queries ====================
	
	LIST_BOOKINGS: `
		query ListBookings(
			$limit: Int = 100
			$page: Int = 1
			$order: BookingOrder
			$include_new: Boolean
			$include_approved: Boolean
			$include_completed: Boolean
			$start_timestamp_from: Int
			$start_timestamp_to: Int
			$location_id: [ID]
			$resource_id: [ID]
		) {
			bookings(
				limit: $limit
				page: $page
				order: $order
				include_new: $include_new
				include_approved: $include_approved
				include_completed: $include_completed
				start_timestamp_from: $start_timestamp_from
				start_timestamp_to: $start_timestamp_to
				location_id: $location_id
				resource_id: $resource_id
			) {
				data {
					booking_id
					title
					notes
					start_timestamp
					end_timestamp
					created_timestamp
					is_new
					is_approved
					is_canceled
					is_rejected
					account {
						account_id
						name
						type
						email
					}
					resource {
						resource_id
						name
						title
						location {
							location_id
							name
						}
					}
					payment {
						unit_amount
					}
					user {
						user_id
						name
						email
					}
					created_by_user {
						user_id
						name
						email
					}
				}
				total
			}
		}
	`,

	GET_UPCOMING_SCHEDULE: `
		query GetUpcomingSchedule(
			$limit: Int = 100
			$end_timestamp_from: Int
			$start_timestamp_to: Int
			$status: [ScheduleEventStatus!]
		) {
			schedule(
				limit: $limit
				end_timestamp_from: $end_timestamp_from
				start_timestamp_to: $start_timestamp_to
				status: $status
			) {
				data {
					type
					booking_id
					assignment_id
					tour_id
					availability_block_id
					title
					start_timestamp
					end_timestamp
					status
					is_recurring
					resource {
						resource_id
						name
						title
					}
					location {
						location_id
						name
					}
					owner_account {
						account_id
						name
						email
					}
					payer_account {
						account_id
						name
						email
					}
				}
				total
			}
		}
	`,	CHECK_AVAILABILITY: `
		query CheckAvailability(
			$resource_id: [ID!]!
			$start_timestamp: Int!
			$end_timestamp: Int!
		) {
			resources(resource_id: $resource_id) {
				data {
					resource_id
					name
					title
					is_bookable
					location {
						location_id
						name
					}
				}
			}
			bookings(
				resource_id: $resource_id
				start_timestamp_from: $start_timestamp
				start_timestamp_to: $end_timestamp
				include_new: true
				include_approved: true
			) {
				data {
					booking_id
					start_timestamp
					end_timestamp
					is_approved
					is_canceled
					is_rejected
					resource {
						resource_id
					}
				}
			}
		}
	`,
	
	GET_BOOKING: `
		query GetBooking($booking_id: ID!) {
			booking(booking_id: $booking_id) {
				booking_id
				title
				notes
				start_timestamp
				end_timestamp
				created_timestamp
				ended_timestamp
				is_new
				is_approved
				is_canceled
				is_rejected
				is_recurring
				is_recurrence_exception
				is_hidden
				external_id
				source
				account {
					account_id
					name
					type
					email
					phone
				}
				resource {
					resource_id
					name
					title
					description
					capacity
					location {
						location_id
						name
						address
					}
				}
				payment {
					unit_amount
					total
					price_description
					tax_rate
					tax
					unlimited_allowance
				}
				user {
					user_id
					name
					email
				}
				created_by_user {
					user_id
					name
					email
				}
				invitees {
					email
					name
				}
				web_link
				online_meeting {
					meeting_id
					join_url
					platform
				}
			}
		}
	`,

	// ==================== Search & Filter Queries ====================
	
	SEARCH_ACCOUNTS: `
		query SearchAccounts(
			$search: String!
			$limit: Int = 20
			$type: [String!]
		) {
			accounts(
				search: $search
				limit: $limit
				type: $type
			) {
				data {
					account_id
					name
					type
					email
					status
					primary_location {
						location_id
						name
					}
				}
				pagination {
					total
				}
			}
		}
	`,

	SEARCH_RESOURCES: `
		query SearchResources(
			$name: String!
			$limit: Int = 20
			$location_id: [ID!]
			$is_bookable: Boolean = true
		) {
			resources(
				name: $name
				limit: $limit
				location_id: $location_id
				is_bookable: $is_bookable
			) {
				data {
					resource_id
					name
					title
					capacity
					is_bookable
					resource_type {
						name
					}
					location {
						location_id
						name
					}
				}
				total
			}
		}
	`,

	SEARCH_BOOKINGS: `
		query SearchBookings(
			$limit: Int = 20
			$page: Int = 1
			$start_timestamp_from: Int
			$start_timestamp_to: Int
			$resource_id: [ID]
			$location_id: [ID]
			$include_new: Boolean = true
			$include_approved: Boolean = true
		) {
			bookings(
				limit: $limit
				page: $page
				start_timestamp_from: $start_timestamp_from
				start_timestamp_to: $start_timestamp_to
				resource_id: $resource_id
				location_id: $location_id
				include_new: $include_new
				include_approved: $include_approved
			) {
				data {
					booking_id
					start_timestamp
					end_timestamp
					status
					owner_account {
						name
						email
					}
					resource {
						resource_id
						name
						location {
							name
						}
					}
				}
				total
			}
		}
	`,

	// ==================== Detailed Information Queries ====================
	
	GET_ACCOUNT_DETAILS: `
		query GetAccountDetails($account: AccountInput!) {
			account(account: $account) {
				account_id
				name
				type
				email
				phone
				status
				created_timestamp
				primary_location {
					location_id
					name
				}
				properties {
					property_id
					value
				}
				plans {
					account_plan_id
					plan_template {
						name
						description
					}
					status
					start_timestamp
					end_timestamp
				}
			}
		}
	`,

	GET_RESOURCE_DETAILS: `
		query GetResourceDetails($resource_id: ID!) {
			resource(resource_id: $resource_id) {
				resource_id
				name
				title
				description
				capacity
				is_bookable
				is_assignable
				resource_type {
					resource_type_id
					name
					booking_experience
				}
				location {
					location_id
					name
					address
					timezone
				}
				properties {
					property_id
					value
				}
				amenities {
					amenity_id
					name
					type
				}
			}
		}
	`,

	GET_RESOURCE: `
		query GetResource($resource_id: ID!) {
			resource(resource_id: $resource_id) {
				resource_id
				name
				title
				description
				capacity
				is_bookable
				is_assignable
				type {
					resource_type_id
					name
					booking_experience
				}
				location {
					location_id
					name
					address
					timezone
				}
			}
		}
	`,

	GET_RESOURCE_SCHEDULE: `
		query GetResourceSchedule(
			$resource_id: ID!
			$start_timestamp_from: Int!
			$start_timestamp_to: Int!
		) {
			bookings(
				resource_id: [$resource_id]
				start_timestamp_from: $start_timestamp_from
				start_timestamp_to: $start_timestamp_to
				include_new: true
				include_approved: true
				include_completed: true
			) {
				data {
					booking_id
					start_timestamp
					end_timestamp
					is_approved
					is_canceled
					is_rejected
					account {
						account_id
						name
					}
				}
			}
			schedule(
				resource: { resource_id: [$resource_id] }
				start_timestamp_from: $start_timestamp_from
				start_timestamp_to: $start_timestamp_to
			) {
				data {
					booking_id
					type
					start_timestamp
					end_timestamp
					status
					title
				}
			}
		}
	`,

	GET_PLAN_TEMPLATE: `
		query GetPlanTemplate($plan_template_id: ID!) {
			planTemplate(plan_template_id: $plan_template_id) {
				plan_template_id
				name
				description
				price_frequency
				allowance_renewal_frequency
				price
				deposit
				set_up_fee
				in_all_locations
				locations {
					location_id
					name
				}
			}
		}
	`,

	// ==================== Analytics & Statistics Queries ====================
	
	GET_ANALYTICS_SUMMARY: `
		query GetAnalyticsSummary($query: AnalyticsQueryInput!) {
			analyticsQuery(query: $query) {
				columns {
					name
					type
				}
				rows
				metadata {
					total_rows
					execution_time
				}
			}
		}
	`,

	GET_BOOKING_STATS: `
		query GetBookingStats(
			$start_timestamp_from: Int
			$start_timestamp_to: Int
			$location_id: [ID!]
		) {
			bookings(
				start_timestamp_from: $start_timestamp_from
				start_timestamp_to: $start_timestamp_to
				location_id: $location_id
				limit: 1000
				include_new: true
				include_approved: true
			) {
				data {
					booking_id
					is_approved
					is_canceled
					is_rejected
					start_timestamp
					end_timestamp
					cost {
						total_amount
						currency
					}
					resource {
						resource_id
						name
						location {
							location_id
							name
						}
					}
				}
				total
			}
		}
	`,

	GET_MEMBER_STATS: `
		query GetMemberStats {
			accounts(limit: 1000) {
				data {
					account_id
					name
					type
					status
					created_timestamp
				}
				total
			}
		}
	`,

	// ==================== Team & Permissions Queries ====================
	
	LIST_TEAMS: `
		query ListTeams(
			$limit: Int = 100
			$page: Int = 1
		) {
			teams(
				limit: $limit
				page: $page
			) {
				data {
					team_id
					name
					description
					created_timestamp
					member_count
					primary_location {
						location_id
						name
					}
				}
				total
			}
		}
	`,

	LIST_MEMBERS: `
		query ListMembers(
			$limit: Int = 100
			$page: Int = 1
			$search: String
		) {
			accounts(
				type: ["Member"]
				limit: $limit
				page: $page
				search: $search
			) {
				data {
					account_id
					name
					email
					phone
					status
					created_timestamp
				}
				total
			}
		}
	`,

	LIST_NEWEST_MEMBERS: `
		query ListNewestMembers(
			$limit: Int = 10
			$page: Int = 1
		) {
			accounts(
				type: ["Member"]
				order: CREATED_DESC
				limit: $limit
				page: $page
			) {
				data {
					account_id
					name
					email
					phone
					status
					created_timestamp
					company
					title
					primary_location {
						location_id
						name
					}
				}
				total
			}
		}
	`,

	GET_MEMBER: `
		query GetMember($account: AccountInput!) {
			account(account: $account) {
				account_id
				name
				type
				type_label {
					label_id
					name
					type
					color
				}
				email
				phone
				status
				created_timestamp
				company
				title
				profession
				industry
				description
				skills
				city
				country
				website
				linkedin
				twitter
				avatar {
					name
					url
					mime
					size
					width
					height
				}
				source
				is_checked_in
				primary_location {
					location_id
					name
					address
					city
					country
				}
				notes {
					note_id
					note
					created_timestamp
					created_by_user {
						user_id
						name
					}
				}
				additional_notification_emails
				enable_autopayments
				require_payment_method
				next_invoicing_timestamp
			}
		}
	`,

	SEARCH_MEMBERS: `
		query SearchMembers(
			$search: String!
			$limit: Int = 20
		) {
			accounts(
				type: ["Member"]
				search: $search
				limit: $limit
			) {
				data {
					account_id
					name
					email
					status
				}
				total
			}
		}
	`,

	GET_TEAM_DETAILS: `
		query GetTeamDetails($team_id: ID!) {
			teamProfile(team_id: $team_id) {
				team_id
				name
				description
				created_timestamp
				primary_location {
					location_id
					name
				}
				members {
					account_id
					name
					email
					role
				}
				properties {
					property_id
					value
				}
			}
		}
	`,

	GET_USER_PERMISSIONS: `
		query GetUserPermissions {
			me {
				user {
					user_id
					name
					email
				}
				member {
					member_id
					is_admin
					status
					permissions {
						resource
						actions
					}
				}
				organization {
					organization_id
					name
					features {
						name
						enabled
					}
				}
			}
		}
	`,

	// ==================== Activity & Event Queries ====================
	
	LIST_EVENTS: `
		query ListEvents(
			$limit: Int = 100
			$page: Int = 1
			$start_timestamp_from: Int
			$start_timestamp_to: Int
			$type: [ScheduleEventType!]
			$location_id: [ID!]
		) {
			schedule(
				limit: $limit
				page: $page
				start_timestamp_from: $start_timestamp_from
				start_timestamp_to: $start_timestamp_to
				type: $type
				location_id: $location_id
			) {
				data {
					event_id
					type
					start_timestamp
					end_timestamp
					status
					title
					description
					location {
						location_id
						name
					}
					resource {
						resource_id
						name
					}
					owner_account {
						account_id
						name
					}
				}
				total
			}
		}
	`,

	GET_EVENT_DETAILS: `
		query GetEventDetails($event_id: ID!) {
			scheduleEvent(event_id: $event_id) {
				event_id
				type
				start_timestamp
				end_timestamp
				status
				title
				description
				notes
				created_timestamp
				location {
					location_id
					name
					address
				}
				resource {
					resource_id
					name
					title
					capacity
				}
				owner_account {
					account_id
					name
					email
				}
				attendees {
					account_id
					name
					email
					status
				}
			}
		}
	`
};

// Export mutations (temporarily empty, can be added later)
export const OPTIX_MUTATIONS: {
	CREATE_BOOKING?: string;
	CANCEL_BOOKING?: string;
	CREATE_MEMBER?: string;
	UPDATE_BOOKING?: string;
} = {
	CREATE_BOOKING: `
		mutation CreateBooking($input: BookingSetInput!) {
			bookingsCommit(input: $input) {
				booking_session_id
				account {
					account_id
					name
					email
				}
				bookings {
					booking_id
					title
					notes
					start_timestamp
					end_timestamp
					is_confirmed
					is_canceled
					is_recurring
					resource_id
					resources {
						resource_id
						name
						title
					}
				}
			}
		}
	`,

	CANCEL_BOOKING: `
		mutation CancelBooking($booking_id: ID!) {
			bookingsCommit(input: {
				bookings: [{
					booking_id: $booking_id
					is_canceled: true
				}]
			}) {
				bookings {
					booking_id
					is_canceled
					title
					start_timestamp
					end_timestamp
				}
			}
		}
	`,

	CREATE_MEMBER: `
		mutation CreateMember(
			$email: String!
			$name: String
			$surname: String
			$phone: String
			$notify_user_by_email: Boolean
			$primary_location_id: ID
			$is_lead: Boolean
		) {
			userCreate(
				email: $email
				name: $name
				surname: $surname
				phone: $phone
				notify_user_by_email: $notify_user_by_email
				primary_location_id: $primary_location_id
				is_lead: $is_lead
			) {
				user_id
				name
				surname
				fullname
				email
				phone
				is_active
				is_lead
				is_pending
				user_since
			}
		}
	`,

	UPDATE_BOOKING: `
		mutation UpdateBooking($input: BookingSetInput!) {
			bookingsCommit(input: $input) {
				booking_session_id
				bookings {
					booking_id
					title
					notes
					start_timestamp
					end_timestamp
					is_confirmed
					is_canceled
					is_recurring
					resource_id
					resources {
						resource_id
						name
						title
					}
				}
			}
		}
	`,
};