# Public REST API coverage audit

## Audit result

In the recorded source snapshot, 179 named operation tools cover every one of the 168 DEFINITION blocks in the xMatters public REST reference. The catalog expands those definitions into 177 operation/path variants and includes 2 additional paths documented in request examples.[1]

This report records current-reference coverage for that snapshot. It does not claim to implement every historical API version, every response self link, or every tenant-specific custom webhook format. No tenant requests were made during the source audit. Source coverage is not proof that every operation is enabled or permitted in a particular tenant.

| Audit fact | Value |
| --- | --- |
| Reference | `https://help.xmatters.com/xmapi/` |
| Fetched (UTC) | `2026-09-26T01:27:58.361551Z` |
| Raw HTML SHA-256 | `a7768b4bc65a89cd02a1943f679b76b8ab2bfb63cc43c868f98458660df396b0` |
| Raw HTML bytes | 4076943 |
| Source headings (all levels, including example/object headings) | 1306 |
| Operation headings / DEFINITION blocks | 168 |
| Individual request examples within DEFINITION blocks | 369 |
| Definition-backed operation/path variants | 177 |
| Additional request-example-backed variants | 2 |
| Named tools | 179 |
| Exact unique method/path templates | 156 |
| Unique method/path shapes (placeholder names collapsed) | 154 |
| Uncovered DEFINITION blocks | 0 |

Separate create and modify operations remain separate named tools even when both use `POST` on the same collection. Query-value examples do not create additional tools. Distinct aliases, nested paths, and explicitly documented identifier templates are separate descriptors. Placeholder spelling and HTTP methods follow the reference. The report lists corrections explicitly rather than silently normalizing them.[1]

### HTTP methods and encodings

| Dimension | Counts |
| --- | --- |
| Methods | POST: 66, GET: 87, DELETE: 19, PUT: 7 |
| Request encoding | multipart: 4, none: 106, json: 67, form: 2 |
| Response encoding | json: 176, binary: 3 |

`none` means no request body. `form` means `application/x-www-form-urlencoded` for OAuth. `multipart` means a file part plus optional body fields, not a JSON file path. `binary` means attachment bytes, including text-file contents, rather than forced JSON parsing. The OAuth examples, file-upload documentation and attachment-response descriptions support these distinctions.[1]

## Reproduce the audit

Run these commands from the repository root, using a [supported Node.js version](../CONTRIBUTING.md#prepare-your-environment):

```sh
# Fully offline: descriptor contract, manifest, counts, correction mappings and catalog digest.
node scripts/audit-api.mjs --offline

# Fetch the current official public reference and check its exact hash, all headings,
# every DEFINITION, and all quotes supporting corrections and extra routes.
node scripts/audit-api.mjs --live

# Recheck a separately downloaded exact HTML snapshot; the vendor document stays outside Git.
node scripts/audit-api.mjs --source /path/to/xmatters-reference.html

# Audit-script tests, independent of runtime HTTP-client/server tests.
node --test tests/catalog-audit.test.mjs
node --test --experimental-test-coverage --test-coverage-include='scripts/audit-api.mjs' tests/catalog-audit.test.mjs
```

The catalog audit also runs in the Vitest unit project through `tests/unit/catalog.test.ts`. That wrapper enforces independent 80% line, branch and function thresholds for the `.mjs` auditor, which the TypeScript-only coverage configuration does not include.

The live fetch uses only the official public help URL, omits credentials, refuses redirects, has a 30-second timeout, and caps the response at 8 MiB. It never reads tenant configuration or calls a tenant API. The auditor exits with a nonzero status if the catalog, source, coverage mapping, evidence or counts no longer match. Even an otherwise harmless upstream HTML change fails the raw-source digest check. Review the change before refreshing provenance.

The recorded snapshot audit and a subsequent real `--live` run returned `ok: true`, 179 tools, 168 definitions, 1306 headings and zero errors. The audit-script unit suite was developed through observed RED/GREEN cycles; its recorded coverage was 100% lines/functions and 86.99% branches. This is separate from the TypeScript runtime coverage gate.

### Updating the catalog

1. Download/read the current official reference without adding its complete contents to the repository.
2. Review **every** new or changed DEFINITION, operation heading, request example, body/URL/query table, and encoding description. Do not treat the parser as an API specification generator.
3. Update `src/operations.json`; preserve distinct named operations that share method/path. Never add a general arbitrary-request tool to conceal missing operations.
4. Update `docs/api-inventory.json`: raw source hash/timestamp/byte count, all headings and definitions, each request-to-tool resolution, method/path/encoding manifest, and verbatim evidence for corrections or example-only additions. Update the canonical descriptor digest and recompute all counts.
5. Update this report's group totals and tool manifest. Run offline/source/live audits and tests. A source-only comparison is insufficient if a descriptor changed.

The inventory stores identifiers, endpoint definitions, short evidence quotations and coverage metadata. It does not contain complete vendor chapters or example programs. The catalog digest is SHA-256 of UTF-8 `JSON.stringify(operations)`; the reference digest is over the original downloaded bytes.

## Request schema boundaries

- JSON bodies remain open and may be **objects or top-level arrays**. This matters for recipient lists and sender/share permissions; an object-only body schema would omit documented requests.[1]
- `bodyParams` and `queryParams` list documented names to help callers find fields; they are not a closed list of allowed fields. Nested objects, device/property/form-section variants, inherited create fields used by modify operations, and tenant-defined JSON trigger properties remain usable.[1]
- `requiredBodyParams` / `requiredQueryParams` are conservative unconditional requirements. Empty lists do not imply the API has no requirements. Device types, incident lookup alternatives, recurrence fields, replacement policy and other conditional constraints are left to API validation. Contradictory upstream labels are documented rather than turned into invented mandatory fields.[1]
- File uploads use a separate base64 file input, not arbitrary local filesystem access. The `file` name in body metadata denotes the documented multipart field; it is not a second required JSON file property.
- OAuth token acquisition and refresh are two separate named `form` actions with `authAction: password` / `refresh`. All grant/client/credential values come from configuration, not model arguments. URL-authentication `apiKey` examples are audited but intentionally do not expose secrets in tool query arguments.
- Each operation descriptor fixes its HTTP method and path template. The catalog does not accept arbitrary URLs, invented HTTP methods, SOAP envelopes, or tenant-private endpoints as alternatives.

## Scope and exclusions

The primary reference uses `/api/xm/1` and separately documents `/api/integration/1/functions/{id}/triggers`; OAuth remains under `/api/xm/1/oauth2/token`. Alerts still use `events` paths and workflows still use `plans` paths.[1]

| Excluded category | Reason |
| --- | --- |
| SOAP / private / UI-only APIs | Not public REST operations in the audited reference. No undocumented tenant routes, UI scraping or arbitrary request escape hatch. |
| Retired Dynamic Teams endpoints | The reference explicitly says these deprecated endpoints are no longer available. Dynamic groups use the cataloged Groups API. |
| Legacy /reapi versioned REST archive | The linked archive explicitly labels these methods deprecated and replaced by the current REST API. Historical 2012–2015 API versions are a separate reference, not included in current-v1 completeness totals. This catalog must not be described as covering every historical xMatters API version. |
| Replaced /groups/{groupId}/calendar | Mentioned only as a replaced endpoint; /on-call is the current documented operation. |
| OAuth revocation endpoint | Revocation is documented as a web-UI action; no public HTTP revoke operation is defined. |
| Response-self-link-only routes | Self links without a documented request operation are retained as audit candidates, not promoted into guessed tools. See reviewedCandidates. |
| Non-JSON arbitrary custom webhook encodings | The reference says custom transform-content triggers can accept tenant-defined formats, without defining a universal request schema. Cataloged trigger tools implement the published JSON request operation; tenant-specific raw XML/text contracts are not invented. |

The separate historical `/reapi` appendix explicitly labels its 2012–2015 methods deprecated and replaced by current REST methods. It is **not** counted as covered here, despite remaining publicly accessible and linked from the modern reference. Claims about "all methods" must preserve this current-reference boundary.[2]

### Reviewed non-definition candidates

The audit also inspected OAuth workflow/revocation/authorization headings, integration-script and shared-library-script headings, renamed/retired API groups, request-example paths, and response self links. The table records the reviewed candidates and decisions.[1]

| Source heading | Candidate | Decision |
| --- | --- | --- |
| [get-a-device](https://help.xmatters.com/xmapi/#get-a-device) | `/api/xm/1/devices/{deviceID}/timeframes` | response-self-link-only; timeframe data is documented through embed=timeframes and device mutation |
| [get-an-event](https://help.xmatters.com/xmapi/#get-an-event) | `/api/xm/1/events/{eventId}/recipients` | response-self-link-only; recipient retrieval is documented through Get an event with embed=recipients |
| [get-who-is-on-call](https://help.xmatters.com/xmapi/#get-who-is-on-call) | `/api/xm/1/groups/{groupID}/shifts/{shiftID}/occurrences/{start}/members` | response-self-link-only; occurrence members are documented through on-call and shift occurrence embeds |
| [get-shared-libraries](https://help.xmatters.com/xmapi/#get-shared-libraries) | `/api/xm/1/shared-libraries` | collection self-link in the response, while the documented GET request requires a plan; do not infer a global library-list tool |
| [get-events](https://help.xmatters.com/xmapi/#get-events) | `/api/xm/1/conferences/{conferenceId}` | response-self-link-only for hosted conferences; no standalone GET request operation is defined here |
| [upload-an-attachment](https://help.xmatters.com/xmapi/#upload-an-attachment) | `/api/xm/1/attachments/{attachmentId}/{fileName}` | temporary upload storage self-link; prose only documents downloading once attached via event/scenario attachment operations |
| [authorize-a-request](https://help.xmatters.com/xmapi/#authorize-a-request) | `—` | OAuth authorization example reuses GET people; not a separate endpoint |
| [alerts](https://help.xmatters.com/xmapi/#alerts) | `—` | Terminology alias; API retains events paths |
| [integration-scripts](https://help.xmatters.com/xmapi/#integration-scripts) | `—` | Describes base64 script fields used by integration mutations; no standalone HTTP operation |
| [shared-library-scripts](https://help.xmatters.com/xmapi/#shared-library-scripts) | `—` | Describes base64 script fields used by shared-library mutations; no standalone HTTP operation |

### Additional documented routes without their own DEFINITION

| Named tool | Method and full path | Evidence / caveat |
| --- | --- | --- |
| `xmatters_trigger_an_incident_form` | `POST /api/xm/1/forms/{formId}/triggers` | Additional path from the official cURL and JavaScript examples; DEFINITION instead describes the custom HTTP Request integration trigger. The Python sample omits /xm/1, so it is not followed. JSON remains open. [Source](https://help.xmatters.com/xmapi/#trigger-an-incident) |
| `xmatters_update_a_shift_by_id` | `POST /api/xm/1/groups/{groupID}/shifts/{shiftID}` | Additional path from the official cURL and Python POST examples. DEFINITION and JavaScript use the collection path. Both are retained as separately named documented variants; tenant execution of the example-only variant is unverified. Examples use body id; the parameter table calls it shiftID. [Source](https://help.xmatters.com/xmapi/#update-a-shift) |

## Transparent corrections and conflicting examples

Each entry below has short literal source quotations in `api-inventory.json`. The live audit checks that every quote still occurs in the cited source section. These editorial decisions are backed by source evidence, not tenant-verified behavioral guarantees.[1]

| ID | Resolution |
| --- | --- |
| C01 | Delete device name: select /device-names, not the unrelated /devices DEFINITION or device-namess cURL typo. |
| C02 | Delete plan endpoint: select plural endpoints based on cURL, JavaScript, Python and self-link agreement. |
| C03 | Treat the malformed occurrences/shifts=... example as a shifts query, not a new route. |
| C04 | Add the missing leading slash to the shift-creation definition; retain its trailing slash. |
| C05 | Get form sections labels query fields BODY PARAMETERS; GET examples and DEFINITION establish query encoding. |
| C06 | Several tables label path identifiers QUERY PARAMETERS. Bind identifiers from the exact path templates; do not invent extra query fields. |
| C07 | Create plan properties labels planId as a required body field although the path and all request examples put the plan identifier in the path. Do not require duplicate body planId. |
| C08 | Shift update examples identify body id; the table says shiftID and prose incorrectly calls it a group UUID. Preserve both collection and example-only path-addressed variants, without forcing either body spelling. |
| C09 | Plan endpoint update examples use body id, but prose and table describe plan. Keep JSON open; do not force contradictory requirements or follow the JavaScript ednpoints typo. |
| C10 | Get signals examples contain a group-scoped URL inconsistent with the documented definition and collection self link. Retain /signals; do not infer a group-scoped API. |
| C11 | Restore shift occurrences: retain /occurrences, not the response-example exclusionss typo. |
| C12 | Create device name: retain /device-names instead of the cURL deviceName spelling; definition and other language examples agree. |
| C13 | Scenario attachment upload uses multipart/form-data despite the nonstandard multi-part/form sample header. The file/body documentation and general attachment-upload operation establish multipart. |
| C14 | OAuth uses the official cURL form-body style, not the insecure Python query-credential example. Configured credentials are never model arguments. |
| C15 | Recipient/sender replacement operations use PUT from DEFINITION and cURL/JavaScript, not requests.post in Python. Array payloads are not reduced to object-only schemas. |
| C16 | Binary download operations return attachment contents even though example clients call response.json; honor response semantics over broken sample parsing. |
| C17 | The Flow Trigger incident route is documented in cURL and JavaScript but absent from DEFINITION; Python omits /xm/1. Retain the two independently documented trigger families. |

Additional non-semantic differences include placeholder case, a definition's trailing slash, and query-value example spelling. These are preserved or described in operation notes. The inventory keeps every raw definition alongside its resolved route so you can inspect exactly what changed.

## Group coverage

| API group | Named tools |
| --- | ---: |
| ATTACHMENTS | 1 |
| AUDITS | 1 |
| CHANGE INTELLIGENCE | 3 |
| DEVICES | 5 |
| DEVICE NAMES | 4 |
| DEVICE TYPES | 1 |
| EVENTS | 9 |
| EVENT SUPPRESSIONS | 1 |
| EXTERNAL CONFERENCE BRIDGES | 5 |
| FORMS | 24 |
| GROUP MEMBERS | 3 |
| GROUPS | 8 |
| IMPORT JOBS | 3 |
| INCIDENTS | 8 |
| INTEGRATIONS | 6 |
| OAUTH | 2 |
| ON-CALL | 1 |
| ON-CALL SUMMARY | 1 |
| PEOPLE | 9 |
| PLANS | 5 |
| PLAN CONSTANTS | 4 |
| PLAN ENDPOINTS | 4 |
| PLAN PROPERTIES | 3 |
| ROLES | 1 |
| SCENARIOS | 9 |
| SCHEDULED MESSAGES | 6 |
| SERVICE DEPENDENCIES | 4 |
| SERVICES | 5 |
| SHARED LIBRARIES | 5 |
| SHIFTS | 11 |
| SIGNALS | 2 |
| SITES | 5 |
| SUBSCRIPTION FORMS | 5 |
| SUBSCRIPTIONS | 10 |
| TEMPORARY ABSENCES | 3 |
| UPLOAD USERS | 2 |
| **Total** | **179** |

## Named tool manifest

Every named descriptor below maps to an official source section, HTTP method, full root path and encoding. `example` marks a path published in request examples rather than DEFINITION. The machine-readable inventory contains the corresponding exact source evidence.[1]

| Named tool | Method | Full root path | Request → response | Source |
| --- | --- | --- | --- | --- |
| `xmatters_upload_an_attachment` | POST | `/api/xm/1/attachments` | multipart → json | [definition](https://help.xmatters.com/xmapi/#upload-an-attachment) |
| `xmatters_get_event_audit_information` | GET | `/api/xm/1/audits` | none → json | [definition](https://help.xmatters.com/xmapi/#get-event-audit-information) |
| `xmatters_get_changes` | GET | `/api/xm/1/changes` | none → json | [definition](https://help.xmatters.com/xmapi/#get-changes) |
| `xmatters_get_a_change` | GET | `/api/xm/1/changes/{changeID}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-change) |
| `xmatters_create_a_change_record` | POST | `/api/xm/1/changes` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-change-record) |
| `xmatters_get_a_device` | GET | `/api/xm/1/devices/{deviceID}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-device) |
| `xmatters_get_devices` | GET | `/api/xm/1/devices` | none → json | [definition](https://help.xmatters.com/xmapi/#get-devices) |
| `xmatters_create_a_device` | POST | `/api/xm/1/devices` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-device) |
| `xmatters_modify_a_device` | POST | `/api/xm/1/devices` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-device) |
| `xmatters_delete_a_device` | DELETE | `/api/xm/1/devices/{deviceID}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-a-device) |
| `xmatters_get_device_names` | GET | `/api/xm/1/device-names` | none → json | [definition](https://help.xmatters.com/xmapi/#get-device-names) |
| `xmatters_create_a_device_name` | POST | `/api/xm/1/device-names` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-device-name) |
| `xmatters_modify_a_device_name` | POST | `/api/xm/1/device-names` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-device-name) |
| `xmatters_delete_a_device_name` | DELETE | `/api/xm/1/device-names/{deviceID}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-a-device-name) |
| `xmatters_get_device_types` | GET | `/api/xm/1/device-types` | none → json | [definition](https://help.xmatters.com/xmapi/#get-device-types) |
| `xmatters_get_events` | GET | `/api/xm/1/events` | none → json | [definition](https://help.xmatters.com/xmapi/#get-events) |
| `xmatters_get_an_event` | GET | `/api/xm/1/events/{eventId}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-an-event) |
| `xmatters_get_event_annotations` | GET | `/api/xm/1/events/{eventID}/annotations` | none → json | [definition](https://help.xmatters.com/xmapi/#get-event-annotations) |
| `xmatters_get_an_event_annotation` | GET | `/api/xm/1/events/{eventID}/annotations/{annotationID}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-an-event-annotation) |
| `xmatters_get_an_event_attachment` | GET | `/api/xm/1/events/{eventId}/attachments/{attachmentId}` | none → binary | [definition](https://help.xmatters.com/xmapi/#get-an-event-attachment) |
| `xmatters_get_user_delivery_data` | GET | `/api/xm/1/events/{eventID}/user-deliveries` | none → json | [definition](https://help.xmatters.com/xmapi/#get-user-delivery-data) |
| `xmatters_trigger_an_event` | POST | `/api/integration/1/functions/{id}/triggers` | json → json | [definition](https://help.xmatters.com/xmapi/#trigger-an-event) |
| `xmatters_add_a_comment_to_an_event` | POST | `/api/xm/1/events/{eventId}/annotations` | json → json | [definition](https://help.xmatters.com/xmapi/#add-a-comment-to-an-event) |
| `xmatters_change_the_status_of_an_event` | POST | `/api/xm/1/events` | json → json | [definition](https://help.xmatters.com/xmapi/#change-the-status-of-an-event) |
| `xmatters_get_suppressed_events` | GET | `/api/xm/1/event-suppressions` | none → json | [definition](https://help.xmatters.com/xmapi/#get-suppressed-events) |
| `xmatters_get_conference_bridges` | GET | `/api/xm/1/conference-bridges` | none → json | [definition](https://help.xmatters.com/xmapi/#get-conference-bridges) |
| `xmatters_get_a_conference_bridge` | GET | `/api/xm/1/conference-bridges/{bridgeId}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-conference-bridge) |
| `xmatters_create_an_external_conference_bridge` | POST | `/api/xm/1/conference-bridges` | json → json | [definition](https://help.xmatters.com/xmapi/#create-an-external-conference-bridge) |
| `xmatters_modify_a_conference_bridge` | POST | `/api/xm/1/conference-bridges` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-conference-bridge) |
| `xmatters_delete_a_conference_bridge` | DELETE | `/api/xm/1/conference-bridges/{bridgeID}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-a-conference-bridge) |
| `xmatters_get_forms` | GET | `/api/xm/1/forms` | none → json | [definition](https://help.xmatters.com/xmapi/#get-forms) |
| `xmatters_get_forms_in_a_plan` | GET | `/api/xm/1/plans/{planId}/forms` | none → json | [definition](https://help.xmatters.com/xmapi/#get-forms-in-a-plan) |
| `xmatters_get_a_form_in_a_plan` | GET | `/api/xm/1/forms/{formId}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-form-in-a-plan) |
| `xmatters_get_a_form_in_a_plan_sender_permissions` | GET | `/api/xm/1/forms/{formId}/sender-permissions` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-form-in-a-plan) |
| `xmatters_get_a_form_in_a_plan_recipients` | GET | `/api/xm/1/forms/{formId}/recipients` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-form-in-a-plan) |
| `xmatters_get_a_form_in_a_plan_nested` | GET | `/api/xm/1/plans/{planId}/forms/{formId}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-form-in-a-plan) |
| `xmatters_get_a_form_in_a_plan_nested_recipients` | GET | `/api/xm/1/plans/{planId}/forms/{formId}/recipients` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-form-in-a-plan) |
| `xmatters_get_a_form_in_a_plan_nested_sender_permissions` | GET | `/api/xm/1/plans/{planId}/forms/{formId}/sender-permissions` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-form-in-a-plan) |
| `xmatters_get_form_message_templates` | GET | `/api/xm/1/forms/{formId}/message-templates` | none → json | [definition](https://help.xmatters.com/xmapi/#get-form-message-templates) |
| `xmatters_get_form_response_options` | GET | `/api/xm/1/plans/{planId}/forms/{formId}/response-options` | none → json | [definition](https://help.xmatters.com/xmapi/#get-form-response-options) |
| `xmatters_get_form_response_options_alias` | GET | `/api/xm/1/forms/{formId}/response-options` | none → json | [definition](https://help.xmatters.com/xmapi/#get-form-response-options) |
| `xmatters_get_form_sections` | GET | `/api/xm/1/forms/{formId}/sections` | none → json | [definition](https://help.xmatters.com/xmapi/#get-form-sections) |
| `xmatters_create_a_plan_form` | POST | `/api/xm/1/plans/{planId}/forms` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-plan-form) |
| `xmatters_create_form_message_templates` | POST | `/api/xm/1/forms/{formId}/message-templates` | json → json | [definition](https://help.xmatters.com/xmapi/#create-form-message-templates) |
| `xmatters_create_form_response_options` | POST | `/api/xm/1/forms/{formId}/response-options` | json → json | [definition](https://help.xmatters.com/xmapi/#create-form-response-options) |
| `xmatters_create_a_form_section` | POST | `/api/xm/1/forms/{formId}/sections` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-form-section) |
| `xmatters_modify_a_plan_form` | POST | `/api/xm/1/plans/{planId}/forms` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-plan-form) |
| `xmatters_modify_a_form_message_template` | POST | `/api/xm/1/forms/{formId}/message-templates` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-form-message-template) |
| `xmatters_modify_a_form_response_option` | POST | `/api/xm/1/forms/{formId}/response-options` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-form-response-option) |
| `xmatters_modify_a_form_section` | POST | `/api/xm/1/forms/{formId}/sections` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-form-section) |
| `xmatters_update_form_recipients` | PUT | `/api/xm/1/forms/{formId}/recipients` | json → json | [definition](https://help.xmatters.com/xmapi/#update-form-recipients) |
| `xmatters_update_form_recipients_nested` | PUT | `/api/xm/1/plans/{planId}/forms/{formId}/recipients` | json → json | [definition](https://help.xmatters.com/xmapi/#update-form-recipients) |
| `xmatters_update_sender_permissions` | PUT | `/api/xm/1/forms/{formId}/sender-permissions` | json → json | [definition](https://help.xmatters.com/xmapi/#update-sender-permissions) |
| `xmatters_update_sender_permissions_nested` | PUT | `/api/xm/1/plans/{planId}/forms/{formId}/sender-permissions` | json → json | [definition](https://help.xmatters.com/xmapi/#update-sender-permissions) |
| `xmatters_get_group_members` | GET | `/api/xm/1/groups/{groupID}/members` | none → json | [definition](https://help.xmatters.com/xmapi/#get-group-members) |
| `xmatters_add_a_member_to_the_group` | POST | `/api/xm/1/groups/{groupID}/members` | json → json | [definition](https://help.xmatters.com/xmapi/#add-a-member-to-the-group) |
| `xmatters_remove_a_member_from_the_group` | DELETE | `/api/xm/1/groups/{groupID}/members/{memberID}` | none → json | [definition](https://help.xmatters.com/xmapi/#remove-a-member-from-the-group) |
| `xmatters_get_a_group` | GET | `/api/xm/1/groups/{groupId}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-group) |
| `xmatters_get_groups` | GET | `/api/xm/1/groups` | none → json | [definition](https://help.xmatters.com/xmapi/#get-groups) |
| `xmatters_create_a_group` | POST | `/api/xm/1/groups` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-group) |
| `xmatters_modify_a_group` | POST | `/api/xm/1/groups` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-group) |
| `xmatters_delete_a_group` | DELETE | `/api/xm/1/groups/{groupID}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-a-group) |
| `xmatters_get_a_group_39_s_supervisors` | GET | `/api/xm/1/groups/{groupId}/supervisors` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-group-39-s-supervisors) |
| `xmatters_get_group_license_quotas` | GET | `/api/xm/1/groups/license-quotas` | none → json | [definition](https://help.xmatters.com/xmapi/#get-group-license-quotas) |
| `xmatters_get_a_group_39_s_recipients` | GET | `/api/xm/1/groups/{groupId}/recipients` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-group-39-s-recipients) |
| `xmatters_get_import_jobs` | GET | `/api/xm/1/imports` | none → json | [definition](https://help.xmatters.com/xmapi/#get-import-jobs) |
| `xmatters_get_an_import_job` | GET | `/api/xm/1/imports/{importId}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-an-import-job) |
| `xmatters_get_import_job_messages` | GET | `/api/xm/1/imports/{importId}/import-messages` | none → json | [definition](https://help.xmatters.com/xmapi/#get-import-job-messages) |
| `xmatters_get_incidents` | GET | `/api/xm/1/incidents` | none → json | [definition](https://help.xmatters.com/xmapi/#get-incidents) |
| `xmatters_get_an_incident` | GET | `/api/xm/1/incidents/{incidentID}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-an-incident) |
| `xmatters_get_an_incident_by_identifier` | GET | `/api/xm/1/incidents/{incidentIdentifier}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-an-incident) |
| `xmatters_trigger_an_incident` | POST | `/api/integration/1/functions/{id}/triggers` | json → json | [definition](https://help.xmatters.com/xmapi/#trigger-an-incident) |
| `xmatters_create_an_incident` | POST | `/api/xm/1/incidents` | json → json | [definition](https://help.xmatters.com/xmapi/#create-an-incident) |
| `xmatters_modify_an_incident` | POST | `/api/xm/1/incidents` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-an-incident) |
| `xmatters_add_a_timeline_note` | POST | `/api/xm/1/incidents/{incidentID}/timeline-entries` | json → json | [definition](https://help.xmatters.com/xmapi/#add-a-timeline-note) |
| `xmatters_get_an_integration` | GET | `/api/xm/1/plans/{planId}/integrations/{integrationId}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-an-integration) |
| `xmatters_get_integrations` | GET | `/api/xm/1/plans/{planId}/integrations` | none → json | [definition](https://help.xmatters.com/xmapi/#get-integrations) |
| `xmatters_get_integration_logs` | GET | `/api/xm/1/integrations/{integrationId}/logs` | none → json | [definition](https://help.xmatters.com/xmapi/#get-integration-logs) |
| `xmatters_create_an_integration` | POST | `/api/xm/1/plans/{planId}/integrations` | json → json | [definition](https://help.xmatters.com/xmapi/#create-an-integration) |
| `xmatters_modify_an_integration` | POST | `/api/xm/1/plans/{planId}/integrations` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-an-integration) |
| `xmatters_delete_an_integration` | DELETE | `/api/xm/1/plans/{planId}/integrations/{integrationId}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-an-integration) |
| `xmatters_obtain_an_access_token_and_refresh_token` | POST | `/api/xm/1/oauth2/token` | form → json | [definition](https://help.xmatters.com/xmapi/#obtain-an-access-token-and-refresh-token) |
| `xmatters_refresh_an_access_token` | POST | `/api/xm/1/oauth2/token` | form → json | [definition](https://help.xmatters.com/xmapi/#refresh-an-access-token) |
| `xmatters_get_who_is_on_call` | GET | `/api/xm/1/on-call` | none → json | [definition](https://help.xmatters.com/xmapi/#get-who-is-on-call) |
| `xmatters_get_on_call_summary` | GET | `/api/xm/1/on-call-summary` | none → json | [definition](https://help.xmatters.com/xmapi/#get-on-call-summary) |
| `xmatters_get_a_person_by_id` | GET | `/api/xm/1/people/{personID}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-person-by-id) |
| `xmatters_get_people` | GET | `/api/xm/1/people` | none → json | [definition](https://help.xmatters.com/xmapi/#get-people) |
| `xmatters_create_a_person` | POST | `/api/xm/1/people` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-person) |
| `xmatters_modify_a_person` | POST | `/api/xm/1/people` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-person) |
| `xmatters_delete_a_person` | DELETE | `/api/xm/1/people/{personID}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-a-person) |
| `xmatters_get_a_person_39_s_devices` | GET | `/api/xm/1/people/{personId}/devices` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-person-39-s-devices) |
| `xmatters_get_a_person_39_s_groups` | GET | `/api/xm/1/people/{personID}/group-memberships` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-person-39-s-groups) |
| `xmatters_get_a_person_39_s_supervisors` | GET | `/api/xm/1/people/{personId}/supervisors` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-person-39-s-supervisors) |
| `xmatters_get_user_license_quotas` | GET | `/api/xm/1/people/license-quotas` | none → json | [definition](https://help.xmatters.com/xmapi/#get-user-license-quotas) |
| `xmatters_get_communication_plans` | GET | `/api/xm/1/plans` | none → json | [definition](https://help.xmatters.com/xmapi/#get-communication-plans) |
| `xmatters_get_a_communication_plan` | GET | `/api/xm/1/plans/{planId}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-communication-plan) |
| `xmatters_create_a_communication_plan` | POST | `/api/xm/1/plans` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-communication-plan) |
| `xmatters_modify_communication_plan` | POST | `/api/xm/1/plans` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-communication-plan) |
| `xmatters_delete_a_plan` | DELETE | `/api/xm/1/plans/{planId}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-a-plan) |
| `xmatters_get_plan_constants` | GET | `/api/xm/1/plans/{planId}/constants` | none → json | [definition](https://help.xmatters.com/xmapi/#get-plan-constants) |
| `xmatters_create_a_plan_constant` | POST | `/api/xm/1/plans/{planId}/constants` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-plan-constant) |
| `xmatters_modify_a_plan_constant` | POST | `/api/xm/1/plans/{planId}/constants` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-plan-constant) |
| `xmatters_delete_a_plan_constant` | DELETE | `/api/xm/1/plans/{planId}/constants/{constantId}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-a-plan-constant) |
| `xmatters_get_plan_endpoints` | GET | `/api/xm/1/plans/{planId}/endpoints` | none → json | [definition](https://help.xmatters.com/xmapi/#get-plan-endpoints) |
| `xmatters_create_plan_endpoint` | POST | `/api/xm/1/plans/{planId}/endpoints` | json → json | [definition](https://help.xmatters.com/xmapi/#create-plan-endpoint) |
| `xmatters_modify_a_plan_endpoint` | POST | `/api/xm/1/plans/{planID}/endpoints` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-plan-endpoint) |
| `xmatters_delete_a_plan_endpoint` | DELETE | `/api/xm/1/plans/{planId}/endpoints/{endpointId}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-a-plan-endpoint) |
| `xmatters_get_plan_properties` | GET | `/api/xm/1/plans/{planId}/property-definitions` | none → json | [definition](https://help.xmatters.com/xmapi/#get-plan-properties) |
| `xmatters_create_plan_properties` | POST | `/api/xm/1/plans/{planId}/property-definitions` | json → json | [definition](https://help.xmatters.com/xmapi/#create-plan-properties) |
| `xmatters_modify_plan_properties` | POST | `/api/xm/1/plans/{planId}/property-definitions` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-plan-properties) |
| `xmatters_get_roles` | GET | `/api/xm/1/roles` | none → json | [definition](https://help.xmatters.com/xmapi/#get-roles) |
| `xmatters_get_scenarios` | GET | `/api/xm/1/scenarios` | none → json | [definition](https://help.xmatters.com/xmapi/#get-scenarios) |
| `xmatters_get_a_scenario` | GET | `/api/xm/1/scenarios/{scenarioId}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-scenario) |
| `xmatters_get_scenarios_in_a_form` | GET | `/api/xm/1/plans/{planId}/forms/{formId}/scenarios` | none → json | [definition](https://help.xmatters.com/xmapi/#get-scenarios-in-a-form) |
| `xmatters_get_a_scenario_attachment` | GET | `/api/xm/1/scenarios/{scenarioId}/attachments/{attachmentId}` | none → binary | [definition](https://help.xmatters.com/xmapi/#get-a-scenario-attachment) |
| `xmatters_get_scenario_sender_permissions` | GET | `/api/xm/1/scenarios/{scenarioId}/sender-permissions` | none → json | [definition](https://help.xmatters.com/xmapi/#get-scenario-sender-permissions) |
| `xmatters_create_a_scenario` | POST | `/api/xm/1/forms/{formId}/scenarios` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-scenario) |
| `xmatters_modify_a_scenario` | POST | `/api/xm/1/forms/{formId}/scenarios` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-scenario) |
| `xmatters_upload_attachment_to_a_scenario` | POST | `/api/xm/1/forms/{formId}/scenarios/{scenarioId}/attachments` | multipart → json | [definition](https://help.xmatters.com/xmapi/#upload-attachment-to-a-scenario) |
| `xmatters_set_scenario_sender_permissions` | PUT | `/api/xm/1/scenarios/{scenarioId}/sender-permissions` | json → json | [definition](https://help.xmatters.com/xmapi/#set-scenario-sender-permissions) |
| `xmatters_get_scheduled_messages` | GET | `/api/xm/1/scheduled-messages` | none → json | [definition](https://help.xmatters.com/xmapi/#get-scheduled-messages) |
| `xmatters_get_a_scheduled_message` | GET | `/api/xm/1/scheduled-messages/{scheduledMessageId}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-scheduled-message) |
| `xmatters_get_a_scheduled_message_attachment` | GET | `/api/xm/1/scheduled-messages/{scheduledMessageId}/attachments/{attachmentId}` | none → binary | [definition](https://help.xmatters.com/xmapi/#get-a-scheduled-message-attachment) |
| `xmatters_create_a_scheduled_message` | POST | `/api/xm/1/scheduled-messages` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-scheduled-message) |
| `xmatters_modify_a_scheduled_message` | POST | `/api/xm/1/scheduled-messages` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-scheduled-message) |
| `xmatters_delete_a_scheduled_message` | DELETE | `/api/xm/1/scheduled-messages/{scheduledMessageId}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-a-scheduled-message) |
| `xmatters_get_service_dependencies` | GET | `/api/xm/1/service-dependencies` | none → json | [definition](https://help.xmatters.com/xmapi/#get-service-dependencies) |
| `xmatters_create_a_service_dependency` | POST | `/api/xm/1/service-dependencies` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-service-dependency) |
| `xmatters_modify_a_service_dependency` | POST | `/api/xm/1/service-dependencies` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-service-dependency) |
| `xmatters_delete_a_service_dependency` | DELETE | `/api/xm/1/service-dependencies/{id}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-a-service-dependency) |
| `xmatters_get_services` | GET | `/api/xm/1/services` | none → json | [definition](https://help.xmatters.com/xmapi/#get-services) |
| `xmatters_get_a_service` | GET | `/api/xm/1/services/{serviceId}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-service) |
| `xmatters_create_a_service` | POST | `/api/xm/1/services` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-service) |
| `xmatters_modify_a_service` | POST | `/api/xm/1/services` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-service) |
| `xmatters_delete_a_service` | DELETE | `/api/xm/1/services/{serviceId}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-a-service) |
| `xmatters_get_shared_libraries` | GET | `/api/xm/1/plans/{planId}/shared-libraries` | none → json | [definition](https://help.xmatters.com/xmapi/#get-shared-libraries) |
| `xmatters_get_a_shared_library` | GET | `/api/xm/1/shared-libraries/{libraryId}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-shared-library) |
| `xmatters_create_a_shared_library` | POST | `/api/xm/1/shared-libraries` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-shared-library) |
| `xmatters_modify_a_shared_library` | POST | `/api/xm/1/shared-libraries` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-shared-library) |
| `xmatters_delete_a_shared_library` | DELETE | `/api/xm/1/shared-libraries/{libraryID}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-a-shared-library) |
| `xmatters_get_a_shift` | GET | `/api/xm/1/groups/{groupID}/shifts/{shiftID}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-shift) |
| `xmatters_get_shifts` | GET | `/api/xm/1/groups/{groupID}/shifts` | none → json | [definition](https://help.xmatters.com/xmapi/#get-shifts) |
| `xmatters_get_members_in_a_shift` | GET | `/api/xm/1/groups/{groupID}/shifts/{shiftID}/members` | none → json | [definition](https://help.xmatters.com/xmapi/#get-members-in-a-shift) |
| `xmatters_get_shift_occurrences` | GET | `/api/xm/1/groups/{groupId}/occurrences` | none → json | [definition](https://help.xmatters.com/xmapi/#get-shift-occurrences) |
| `xmatters_get_deleted_shift_occurrences` | GET | `/api/xm/1/groups/{groupID}/shifts/{shiftID}/exclusions` | none → json | [definition](https://help.xmatters.com/xmapi/#get-deleted-shift-occurrences) |
| `xmatters_create_a_shift` | POST | `/api/xm/1/groups/{groupID}/shifts/` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-shift) |
| `xmatters_update_a_shift` | POST | `/api/xm/1/groups/{groupID}/shifts` | json → json | [definition](https://help.xmatters.com/xmapi/#update-a-shift) |
| `xmatters_add_a_member_to_a_shift` | POST | `/api/xm/1/groups/{groupID}/shifts/{shiftID}/members` | json → json | [definition](https://help.xmatters.com/xmapi/#add-a-member-to-a-shift) |
| `xmatters_delete_a_shift` | DELETE | `/api/xm/1/groups/{groupID}/shifts/{shiftID}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-a-shift) |
| `xmatters_restore_deleted_shift_occurrences` | POST | `/api/xm/1/groups/{groupID}/shifts/{shiftID}/occurrences` | json → json | [definition](https://help.xmatters.com/xmapi/#restore-deleted-shift-occurrences) |
| `xmatters_get_signals` | GET | `/api/xm/1/signals` | none → json | [definition](https://help.xmatters.com/xmapi/#get-signals) |
| `xmatters_get_a_signal` | GET | `/api/xm/1/signals/{signalID}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-signal) |
| `xmatters_get_a_site` | GET | `/api/xm/1/sites/{siteID}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-site) |
| `xmatters_get_sites` | GET | `/api/xm/1/sites` | none → json | [definition](https://help.xmatters.com/xmapi/#get-sites) |
| `xmatters_create_a_site` | POST | `/api/xm/1/sites` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-site) |
| `xmatters_modify_a_site` | POST | `/api/xm/1/sites/` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-site) |
| `xmatters_delete_a_site` | DELETE | `/api/xm/1/sites/{siteID}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-a-site) |
| `xmatters_get_a_subscription_form` | GET | `/api/xm/1/subscription-forms/{subscriptionFormId}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-subscription-form) |
| `xmatters_get_subscription_forms` | GET | `/api/xm/1/subscription-forms` | none → json | [definition](https://help.xmatters.com/xmapi/#get-subscription-forms) |
| `xmatters_get_subscription_forms_in_a_plan` | GET | `/api/xm/1/plans/{planId}/subscription-forms` | none → json | [definition](https://help.xmatters.com/xmapi/#get-subscription-forms-in-a-plan) |
| `xmatters_create_a_subscription_form` | POST | `/api/xm/1/plans/{planId}/subscription-forms` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-subscription-form) |
| `xmatters_modify_a_subscription_form` | POST | `/api/xm/1/plans/{planId}/subscription-forms` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-subscription-form) |
| `xmatters_get_subscriptions` | GET | `/api/xm/1/subscriptions` | none → json | [definition](https://help.xmatters.com/xmapi/#get-subscriptions) |
| `xmatters_get_a_subscription` | GET | `/api/xm/1/subscriptions/{subscriptionId}` | none → json | [definition](https://help.xmatters.com/xmapi/#get-a-subscription) |
| `xmatters_get_subscribers` | GET | `/api/xm/1/subscriptions/{subscriptionId}/subscribers` | none → json | [definition](https://help.xmatters.com/xmapi/#get-subscribers) |
| `xmatters_get_subscription_share_permissions` | GET | `/api/xm/1/subscriptions/{subscriptionId}/share-permissions` | none → json | [definition](https://help.xmatters.com/xmapi/#get-subscription-share-permissions) |
| `xmatters_create_a_subscription` | POST | `/api/xm/1/subscriptions` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-subscription) |
| `xmatters_modify_a_subscription` | POST | `/api/xm/1/subscriptions` | json → json | [definition](https://help.xmatters.com/xmapi/#modify-a-subscription) |
| `xmatters_add_subscribers` | PUT | `/api/xm/1/subscriptions/{subscriptionId}/subscribers` | json → json | [definition](https://help.xmatters.com/xmapi/#add-subscribers) |
| `xmatters_set_subscription_share_permissions` | PUT | `/api/xm/1/subscriptions/{subscriptionId}/share-permissions` | json → json | [definition](https://help.xmatters.com/xmapi/#set-subscription-share-permissions) |
| `xmatters_delete_a_subscription` | DELETE | `/api/xm/1/subscriptions/{subscriptionId}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-a-subscription) |
| `xmatters_unsubscribe_a_user` | DELETE | `/api/xm/1/subscriptions/{subscriptionId}/subscribers/{personId}` | none → json | [definition](https://help.xmatters.com/xmapi/#unsubscribe-a-user) |
| `xmatters_get_temporary_absences` | GET | `/api/xm/1/temporary-absences` | none → json | [definition](https://help.xmatters.com/xmapi/#get-temporary-absences) |
| `xmatters_create_a_temporary_absence` | POST | `/api/xm/1/temporary-absences` | json → json | [definition](https://help.xmatters.com/xmapi/#create-a-temporary-absence) |
| `xmatters_delete_a_temporary_absence` | DELETE | `/api/xm/1/temporary-absences/{temporaryAbsenceId}` | none → json | [definition](https://help.xmatters.com/xmapi/#delete-a-temporary-absence) |
| `xmatters_upload_a_user_upload_file` | POST | `/api/xm/1/uploads/users-v1` | multipart → json | [definition](https://help.xmatters.com/xmapi/#upload-a-user-upload-file) |
| `xmatters_upload_an_epic_zipsync_file` | POST | `/api/xm/1/uploads/epic-v1` | multipart → json | [definition](https://help.xmatters.com/xmapi/#upload-an-epic-zipsync-file) |
| `xmatters_trigger_an_incident_form` | POST | `/api/xm/1/forms/{formId}/triggers` | json → json | [example](https://help.xmatters.com/xmapi/#trigger-an-incident) |
| `xmatters_update_a_shift_by_id` | POST | `/api/xm/1/groups/{groupID}/shifts/{shiftID}` | json → json | [example](https://help.xmatters.com/xmapi/#update-a-shift) |

## Sources

[1] https://help.xmatters.com/xmapi — xMatters REST API reference
[2] https://help.xmatters.com/ondemand/workflows/appendixrestapi.htm — Deprecated REST API methods (linked from current reference)
