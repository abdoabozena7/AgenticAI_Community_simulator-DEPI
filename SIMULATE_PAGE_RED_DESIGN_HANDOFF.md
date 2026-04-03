# SIMULATE_PAGE_RED_DESIGN_HANDOFF

## 1) Page identity

- **Exact route/path**
  - `/simulate`
  - Registered in `frontend/src/App.tsx`
  - Wrapped in `RequireAuth`, so unauthenticated users are redirected to `/?auth=login`

- **Main component name(s)**
  - Route component: `Index` in `frontend/src/pages/Index.tsx`
  - Page shell components used directly by the route:
    - `Header`
    - `TopBar`
    - `ConfigPanel`
    - `ChatPanel`
    - `GuidedSimulationPanel`
    - `SimulationPanel`
    - `SearchPanel`
    - `MetricsPanel`
  - Major lower-level visualization/support components:
    - `SimulationArena`
    - `IterationTimeline`
    - `SearchLivePanel`

- **File locations involved**
  - Route registration: `frontend/src/App.tsx`
  - Main page orchestration: `frontend/src/pages/Index.tsx`
  - Simulation state orchestration: `frontend/src/hooks/useSimulation.ts`
  - Guided workflow orchestration: `frontend/src/hooks/useGuidedWorkflow.ts`
  - Shared types: `frontend/src/types/simulation.ts`
  - API layer: `frontend/src/services/api.ts`
  - UI state mapping: `frontend/src/lib/simulationUi.ts`
  - Search panel mapping: `frontend/src/lib/searchPanelModel.ts`
  - Shared styling/theme: `frontend/src/index.css`, `frontend/tailwind.config.ts`, `frontend/src/contexts/ThemeContext.tsx`, `frontend/src/contexts/LanguageContext.tsx`
  - Relevant backend routes and workflow code:
    - `backend/app/api/routes.py`
    - `backend/app/api/guided_workflow.py`
    - `backend/app/api/persona_lab.py`
    - `backend/app/api/websocket.py`

- **Standalone or nested**
  - This is effectively a standalone workspace page.
  - It is not nested inside the dashboard shell.
  - It renders its own `Header` and `TopBar`.
  - It still sits inside app-level providers from `App.tsx`:
    - React Query
    - Theme provider
    - Language provider
    - Tooltip provider
    - Error boundary

- **What user role(s) can access it**
  - Any authenticated user.
  - Not admin-only.
  - Guest users cannot access it.
  - No route-level feature flag was found around `/simulate`.

- **When and why users open this page**
  - To turn an idea into a structured simulation run.
  - To complete the app’s required pre-start workflow:
    - normalize idea context
    - fill missing schema
    - clarify the idea if needed
    - run mandatory research
    - prepare or select personas/society setup
  - To launch and monitor the actual agent-based simulation/debate.
  - To inspect reasoning, metrics, pauses, interventions, and follow-up actions.
  - To resume a prior simulation using:
    - route query `simulation_id`
    - persisted `activeSimulationId`
    - navigation/localStorage drafts such as `pendingIdea`, `dashboardIdea`, `pendingSimulationDraft`

- **Main business purpose in simple product language**
  - This page lets a signed-in user test whether an idea is viable before launch by forcing a research-backed setup, generating an audience/society context, and then running a live multi-agent evaluation and debate.

## 2) What the page currently does

- **Plain-English summary**
  - The page is not just a “run simulation” screen.
  - It is a guided execution pipeline that collects idea details, fills gaps, asks clarifying questions, runs mandatory pre-start research, chooses how personas/society should be sourced, starts the simulation, then lets the user review live reasoning, results, interventions, and follow-up actions.

- **Core user journey**
  1. User opens `/simulate` while authenticated.
  2. The page restores existing context from URL, localStorage, or navigation state when available.
  3. The user provides idea details via chat, quick-reply chips, or config panel controls.
  4. The page attempts schema extraction to infer missing category, audience, goals, risk, maturity, and sometimes location.
  5. If required information is still missing, the page explicitly asks for it in chat.
  6. If the idea still needs clarification, the preflight/understanding gate asks structured questions.
  7. The user must confirm the generated idea framing when the preflight step produces one.
  8. Mandatory pre-start research runs and may require review or retry.
  9. The user chooses a start path:
     - inspect default society
     - build custom society
     - continue with default society
  10. For general ideas without location/persona context, the user may need to choose a persona source.
  11. The simulation starts.
  12. During the run, the page may pause for clarification, runtime research review, coach intervention, credits exhaustion, or manual pause.
  13. The user can inspect reasoning, metrics, reports, interventions, and follow-up actions.

- **Main value provided**
  - The page reduces the chance of launching an under-defined idea by enforcing a research-backed, context-aware simulation pipeline rather than a raw prompt-to-output workflow.

- **Top tasks users can do**
  - Enter or refine an idea.
  - Provide missing schema fields and location context.
  - Approve or edit an auto-generated idea framing.
  - Run mandatory pre-start research and review the research quality/gaps.
  - Choose how the simulation society/personas should be prepared.
  - Start the simulation.
  - Pause/resume the simulation.
  - Inspect reasoning and live debate.
  - Respond to runtime clarification or research review pauses.
  - Handle coach intervention suggestions and rerun with corrections.
  - Review metrics and acceptance trends.
  - Generate a downloadable report.
  - Trigger post-run follow-up actions.

## 3) Full UI inventory

### A. Global page shell

#### 1. Header brand block
- **Label/text**
  - English title: `Point of no return` with the word `no` visually struck through
  - English subtitle: `Test your ideas before launching them`
  - Arabic equivalents exist
- **Type**
  - Header identity block
- **Where**
  - Top of page
- **What it does**
  - Brands the workspace and visually signals active simulation state
- **Trigger**
  - Always rendered by `Index`
- **Reads/writes**
  - Reads language, simulation running state
- **Visibility**
  - Always visible
- **Disabled/enabled**
  - Not interactive except embedded actions nearby
- **Validation**
  - None
- **Side effects**
  - Animated pulse dot appears when simulation is running

#### 2. Back to dashboard button
- **Label/text**
  - `Back to dashboard`
- **Type**
  - Button/pill
- **Where**
  - Header actions
- **What it does**
  - Navigates back to dashboard
- **Trigger**
  - Click
- **Reads/writes**
  - Navigation only
- **Visibility**
  - Visible when page is not in a dashboard-embedded context
- **Disabled/enabled**
  - Enabled when shown
- **Validation**
  - None
- **Side effects**
  - Route change

#### 3. Log out button
- **Label/text**
  - `Log out`
- **Type**
  - Button/pill
- **Where**
  - Header actions
- **What it does**
  - Clears auth session via API service flow
- **Trigger**
  - Click
- **Reads/writes**
  - Auth tokens/session
- **Visibility**
  - Visible in header
- **Disabled/enabled**
  - Enabled when shown
- **Validation**
  - None
- **Side effects**
  - User becomes guest and is redirected away on protected routes

#### 4. Realtime connection status pill
- **Label/text**
  - `Realtime: Connected`
  - `Realtime: Reconnecting`
  - `Realtime: Disconnected`
- **Type**
  - Status badge/pill
- **Where**
  - Header actions
- **What it does**
  - Shows websocket connectivity status
- **Trigger**
  - Websocket lifecycle changes
- **Reads/writes**
  - Reads realtime status from simulation hook
- **Visibility**
  - Always visible
- **Disabled/enabled**
  - Non-interactive
- **Validation**
  - None
- **Side effects**
  - None

#### 5. Header settings button
- **Label/text**
  - Settings icon/pill
- **Type**
  - Popover trigger
- **Where**
  - Header actions
- **What it does**
  - Opens settings popover
- **Trigger**
  - Click
- **Reads/writes**
  - UI settings state
- **Visibility**
  - Always visible
- **Disabled/enabled**
  - Enabled
- **Validation**
  - None
- **Side effects**
  - Shows settings panel; closes on outside click/scroll/resize

#### 6. Settings popover: language toggle
- **Label/text**
  - Arabic/English options
- **Type**
  - Segmented control / buttons
- **Where**
  - Header settings popover
- **What it does**
  - Switches UI language
- **Trigger**
  - Click
- **Reads/writes**
  - `LanguageContext`
  - persisted `appSettings`
- **Visibility**
  - Conditional when settings popover is open
- **Disabled/enabled**
  - Enabled
- **Validation**
  - Only supported languages `ar`, `en`
- **Side effects**
  - Updates document `lang` and `dir`
  - Re-renders all translated labels

#### 7. Settings popover: theme selector
- **Label/text**
  - Light / Dark
- **Type**
  - Select/toggle
- **Where**
  - Header settings popover
- **What it does**
  - Switches app theme
- **Trigger**
  - Change/click
- **Reads/writes**
  - `ThemeContext`
  - persisted `appSettings`
- **Visibility**
  - Conditional when settings popover is open
- **Disabled/enabled**
  - Enabled
- **Validation**
  - Only supported themes are used
- **Side effects**
  - Switches theme classes and CSS variables

#### 8. Settings popover: auto focus checkbox
- **Label/text**
  - `Auto focus`
- **Type**
  - Checkbox
- **Where**
  - Header settings popover
- **What it does**
  - Controls whether input areas auto-focus
- **Trigger**
  - Check/uncheck
- **Reads/writes**
  - local UI state persisted in settings
- **Visibility**
  - Conditional when settings popover is open
- **Disabled/enabled**
  - Enabled
- **Validation**
  - Boolean only
- **Side effects**
  - Changes focus behavior across chat/config interactions

#### 9. Header simulation status pill
- **Label/text**
  - One of: `Idle`, `Configuring`, `Running`, `Paused`, `Completed`, `Error`
- **Type**
  - Status badge/pill
- **Where**
  - Header actions
- **What it does**
  - Shows current simulation state
- **Trigger**
  - Simulation status changes
- **Reads/writes**
  - Reads simulation state
- **Visibility**
  - Always visible
- **Disabled/enabled**
  - Non-interactive
- **Validation**
  - None
- **Side effects**
  - None

### B. TopBar

#### 10. Screen title
- **Label/text**
  - Default English: `Idea evaluation pipeline`
  - Changes according to UI state mapping
- **Type**
  - Title text
- **Where**
  - TopBar
- **What it does**
  - Labels the current workspace stage
- **Trigger**
  - Simulation/search/pipeline state changes
- **Reads/writes**
  - Derived from `buildSimulationUiState`
- **Visibility**
  - Always visible
- **Disabled/enabled**
  - N/A
- **Validation**
  - None
- **Side effects**
  - None

#### 11. Stage label badge
- **Label/text**
  - Current active pipeline step or fallback `Idea intake`
- **Type**
  - Badge
- **Where**
  - TopBar
- **What it does**
  - Indicates current step within the pipeline
- **Trigger**
  - Pipeline changes
- **Reads/writes**
  - Pipeline state
- **Visibility**
  - Always visible
- **Disabled/enabled**
  - Non-interactive
- **Validation**
  - None
- **Side effects**
  - None

#### 12. Theme badge
- **Label/text**
  - `Dark mode` or `Light mode`
- **Type**
  - Badge
- **Where**
  - TopBar
- **What it does**
  - Shows current theme
- **Trigger**
  - Theme change
- **Reads/writes**
  - Theme context
- **Visibility**
  - Always visible
- **Disabled/enabled**
  - Non-interactive
- **Validation**
  - None
- **Side effects**
  - None

#### 13. Current status chip
- **Label/text**
  - Derived from current pipeline/search/error state
- **Type**
  - Status chip
- **Where**
  - TopBar
- **What it does**
  - Communicates current execution condition
- **Trigger**
  - Search/pipeline/error state changes
- **Reads/writes**
  - `buildSimulationUiState`
- **Visibility**
  - Always visible
- **Disabled/enabled**
  - Non-interactive
- **Validation**
  - None
- **Side effects**
  - Tone changes based on success/warning/error/info

#### 14. Chat panel button
- **Label/text**
  - `Chat`
- **Type**
  - Panel switch button
- **Where**
  - TopBar
- **What it does**
  - Switches active side panel to chat
- **Trigger**
  - Click
- **Reads/writes**
  - `activePanel`
- **Visibility**
  - Always visible
- **Disabled/enabled**
  - Enabled
- **Validation**
  - None
- **Side effects**
  - Clears highlighted reasoning in some transitions

#### 15. Reasoning panel button
- **Label/text**
  - `Reasoning` and optionally `Reasoning (N)`
- **Type**
  - Panel switch button
- **Where**
  - TopBar
- **What it does**
  - Switches side panel to reasoning feed
- **Trigger**
  - Click
- **Reads/writes**
  - `activePanel`, reasoning feed count
- **Visibility**
  - Always visible
- **Disabled/enabled**
  - Disabled until reasoning is available
  - Disabled reason is exposed by title/tooltip text
- **Validation**
  - None
- **Side effects**
  - Highlights reasoning-focused workflow

#### 16. Config panel button
- **Label/text**
  - `Config`
- **Type**
  - Panel switch button
- **Where**
  - TopBar
- **What it does**
  - Switches side panel to config panel
- **Trigger**
  - Click
- **Reads/writes**
  - `activePanel`
- **Visibility**
  - Always visible
- **Disabled/enabled**
  - Can be disabled when config is locked or panel access is gated
- **Validation**
  - None
- **Side effects**
  - Clears highlighted reasoning when switching from coach/reasoning context

#### 17. Progress strip
- **Label/text**
  - Pipeline step labels
- **Type**
  - Horizontal step tracker
- **Where**
  - TopBar
- **What it does**
  - Shows completed/current/upcoming steps with subtle status detail
- **Trigger**
  - When pipeline data exists
- **Reads/writes**
  - Pipeline step list
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Non-interactive
- **Validation**
  - None
- **Side effects**
  - Gives process visibility without changing logic

### C. Page-level banners and notices

#### 18. Guided phase notice banner
- **Label/text**
  - Varies by guided workflow stage
- **Type**
  - Informational banner
- **Where**
  - Above main content
- **What it does**
  - Explains that user is in guided pipeline mode
- **Trigger**
  - Guided workflow active
- **Reads/writes**
  - Guided workflow stage/status
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - N/A
- **Validation**
  - None
- **Side effects**
  - None

#### 19. Credit notice banner
- **Label/text**
  - Credits exhausted/low-credit message with `Buy credits`
- **Type**
  - Warning banner + CTA
- **Where**
  - Above main content
- **What it does**
  - Warns about inability to continue when credits are exhausted
- **Trigger**
  - `isCreditsBlocked(meSnapshot)` true
- **Reads/writes**
  - User account/credit snapshot
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - CTA enabled
- **Validation**
  - None
- **Side effects**
  - CTA navigates to `/bonus`

#### 20. Clarification pause banner
- **Label/text**
  - Pause explanation and clarification summary
- **Type**
  - Warning/attention banner
- **Where**
  - Above main content
- **What it does**
  - Indicates simulation is paused and requires clarification
- **Trigger**
  - `paused_clarification_needed`
- **Reads/writes**
  - `pendingClarification`, simulation status
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - N/A
- **Validation**
  - None
- **Side effects**
  - Active panel is forced to chat

#### 21. Research review pause banner
- **Label/text**
  - Pause explanation and runtime research review prompt
- **Type**
  - Warning banner
- **Where**
  - Above main content
- **What it does**
  - Indicates runtime research review is required before continuing
- **Trigger**
  - `paused_research_review` with runtime review gate
- **Reads/writes**
  - `pendingResearchReview`
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - N/A
- **Validation**
  - None
- **Side effects**
  - Active panel forced to chat

#### 22. Coach pause banner
- **Label/text**
  - Coach intervention summary
- **Type**
  - Warning banner
- **Where**
  - Above main content
- **What it does**
  - Indicates the run is paused because a coach intervention needs review
- **Trigger**
  - `paused_coach_intervention`
- **Reads/writes**
  - `coachIntervention`
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - N/A
- **Validation**
  - None
- **Side effects**
  - Active panel forced to chat

### D. Modal/popup inventory

#### 23. Persona source modal
- **Label/text**
  - Explains persona source is required for general ideas
  - Options vary by available persona sources:
    - continue with audience personas only
    - go to Persona Lab
    - select saved place persona set
- **Type**
  - Modal
- **Where**
  - Overlay on top of page
- **What it does**
  - Forces user to choose persona sourcing before safe start
- **Trigger**
  - Start flow when idea is general/non-location and no persona source mode is resolved
- **Reads/writes**
  - persona source mode
  - persona set key/label
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Loading state while persona library loads
- **Validation**
  - Requires a valid choice before proceeding
- **Side effects**
  - Can navigate to Persona Lab
  - Can set persona mode to saved or default
  - Unblocks `handleStart`

#### 24. Start choice modal
- **Label/text**
  - Options:
    - inspect current society
    - build custom society
    - continue with default society
- **Type**
  - Modal
- **Where**
  - Overlay on top of page
- **What it does**
  - Forces explicit start-path selection for each unique configuration key
- **Trigger**
  - Start flow when current start-path key has not been resolved
- **Reads/writes**
  - `selectedStartPath`
  - `showSocietyBuilder`
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Enabled; can show loading if custom society build is later invoked
- **Validation**
  - Requires user to pick one path
- **Side effects**
  - Determines whether custom society config is included in start payload

### E. Side panel area: ConfigPanel

#### 25. Section card: Location and context
- **Label/text**
  - `Location and context`
- **Type**
  - Section/card
- **Where**
  - Config panel
- **What it does**
  - Groups location fields
- **Trigger**
  - Always in config panel
- **Reads/writes**
  - `country`, `city`, optional `placeName`
- **Visibility**
  - Visible in config mode
- **Disabled/enabled**
  - Inputs locked when `controlsLocked`
- **Validation**
  - Country/city may be required depending on location choice
- **Side effects**
  - Missing fields can receive destructive styling and auto-focus

#### 26. Country input
- **Label/text**
  - Country field
- **Type**
  - Text input
- **Where**
  - Config panel, location section
- **What it does**
  - Sets country context
- **Trigger**
  - User typing
- **Reads/writes**
  - `userInput.country`
- **Visibility**
  - Visible in config panel
- **Disabled/enabled**
  - Disabled when config is locked/searching
- **Validation**
  - Required when location context is needed
- **Side effects**
  - Impacts missing-fields logic and config completeness

#### 27. City input
- **Label/text**
  - City field
- **Type**
  - Text input
- **Where**
  - Config panel, location section
- **What it does**
  - Sets city context
- **Trigger**
  - User typing
- **Reads/writes**
  - `userInput.city`
- **Visibility**
  - Visible in config panel
- **Disabled/enabled**
  - Disabled when config is locked/searching
- **Validation**
  - Required when user chose location-based path
- **Side effects**
  - Impacts location string, persona source defaults, research query, missing-fields logic

#### 28. Section card: Category and audience
- **Label/text**
  - `Category and audience`
- **Type**
  - Section/card
- **Where**
  - Config panel
- **What it does**
  - Groups idea classification controls
- **Trigger**
  - Always in config panel
- **Reads/writes**
  - `category`, `targetAudience`
- **Visibility**
  - Visible in config mode
- **Disabled/enabled**
  - All child controls lock with config lock
- **Validation**
  - Category required
  - At least one audience required
- **Side effects**
  - Setting values marks fields as touched so extraction no longer overrides them

#### 29. Category option chips
- **Label/text**
  - From `CATEGORY_OPTIONS`
- **Type**
  - Single-select chips/buttons
- **Where**
  - Config panel
- **What it does**
  - Sets idea category
- **Trigger**
  - Click
- **Reads/writes**
  - `userInput.category`
  - touched state for category
- **Visibility**
  - Visible in config mode
- **Disabled/enabled**
  - Disabled when controls are locked
- **Validation**
  - Category is required before confirm/start
- **Side effects**
  - Prevents schema extraction from overriding user-selected category

#### 30. Audience option chips
- **Label/text**
  - From `AUDIENCE_OPTIONS`
- **Type**
  - Multi-select chips/buttons
- **Where**
  - Config panel
- **What it does**
  - Sets target audiences
- **Trigger**
  - Click
- **Reads/writes**
  - `userInput.targetAudience`
  - touched state for audience
- **Visibility**
  - Visible in config mode
- **Disabled/enabled**
  - Disabled when controls are locked
- **Validation**
  - At least one audience required
- **Side effects**
  - Prevents extraction override for audience

#### 31. Section card: Maturity and goals
- **Label/text**
  - `Maturity and goals`
- **Type**
  - Section/card
- **Where**
  - Config panel
- **What it does**
  - Groups idea maturity and goals
- **Trigger**
  - Always in config panel
- **Reads/writes**
  - `ideaMaturity`, `goals`
- **Visibility**
  - Visible in config mode
- **Disabled/enabled**
  - Child controls lock with config lock
- **Validation**
  - At least one goal required
- **Side effects**
  - Marks touched state

#### 32. Idea maturity cards
- **Label/text**
  - From `MATURITY_LEVELS`
- **Type**
  - Single-select card/button group
- **Where**
  - Config panel
- **What it does**
  - Sets maturity stage
- **Trigger**
  - Click
- **Reads/writes**
  - `userInput.ideaMaturity`
  - touched state for maturity
- **Visibility**
  - Visible in config mode
- **Disabled/enabled**
  - Disabled when controls are locked
- **Validation**
  - Not listed as a hard blocker in `getMissingForStart`, but is part of config and extraction
- **Side effects**
  - Prevents extraction override for maturity

#### 33. Goal option chips
- **Label/text**
  - From `GOAL_OPTIONS`
- **Type**
  - Multi-select chips/buttons
- **Where**
  - Config panel
- **What it does**
  - Sets simulation goals
- **Trigger**
  - Click
- **Reads/writes**
  - `userInput.goals`
  - touched state for goals
- **Visibility**
  - Visible in config mode
- **Disabled/enabled**
  - Disabled when controls are locked
- **Validation**
  - At least one goal required
- **Side effects**
  - Prevents extraction override for goals

#### 34. Section card: Risk and simulation scale
- **Label/text**
  - `Risk and simulation scale`
- **Type**
  - Section/card
- **Where**
  - Config panel
- **What it does**
  - Groups quantitative controls
- **Trigger**
  - Always in config panel
- **Reads/writes**
  - `riskAppetite`, `agentCount`
- **Visibility**
  - Visible in config mode
- **Disabled/enabled**
  - Child controls lock with config lock
- **Validation**
  - `agentCount` documented in type comments as 5..500
  - UI risk is 0..100 and later normalized to 0..1 for API
- **Side effects**
  - Affects simulation payload

#### 35. Risk appetite slider
- **Label/text**
  - Risk appetite
- **Type**
  - Slider
- **Where**
  - Config panel
- **What it does**
  - Sets risk sensitivity level
- **Trigger**
  - Drag/change
- **Reads/writes**
  - `userInput.riskAppetite`
  - touched state for risk
- **Visibility**
  - Visible in config mode
- **Disabled/enabled**
  - Disabled when controls are locked
- **Validation**
  - Numeric range expected 0..100
- **Side effects**
  - Converted to API `riskAppetite` 0..1 during payload build

#### 36. Agent count slider
- **Label/text**
  - Agents count
- **Type**
  - Slider
- **Where**
  - Config panel
- **What it does**
  - Sets number of agents/simulation scale
- **Trigger**
  - Drag/change
- **Reads/writes**
  - `userInput.agentCount`
- **Visibility**
  - Visible in config mode
- **Disabled/enabled**
  - Disabled when controls are locked
- **Validation**
  - Intended range 5..500
- **Side effects**
  - Changes load/scale of run

#### 37. Section card: Society builder
- **Label/text**
  - `Society builder`
  - Description: default society or open advanced builder before running
- **Type**
  - Section/card
- **Where**
  - Config panel
- **What it does**
  - Controls society start mode and advanced custom society options
- **Trigger**
  - Visible in config panel
- **Reads/writes**
  - `selectedStartPath`, society custom spec fields
- **Visibility**
  - Visible in config mode
- **Disabled/enabled**
  - Child controls lock with config lock/searching
- **Validation**
  - No extra validation found beyond control ranges/booleans
- **Side effects**
  - Can change start modal resolution and payload structure

#### 38. Start choices button
- **Label/text**
  - `Start choices`
- **Type**
  - Button
- **Where**
  - Society builder section
- **What it does**
  - Opens start-choice modal
- **Trigger**
  - Click
- **Reads/writes**
  - start choice modal open state
- **Visibility**
  - Visible in config panel
- **Disabled/enabled**
  - Disabled when locked/searching
- **Validation**
  - None
- **Side effects**
  - Prompts explicit start path selection

#### 39. Open/Hide advanced builder button
- **Label/text**
  - `Open advanced builder`
  - `Hide advanced builder`
- **Type**
  - Toggle button
- **Where**
  - Society builder section
- **What it does**
  - Reveals/hides advanced society controls
- **Trigger**
  - Click
- **Reads/writes**
  - `showSocietyBuilder`
- **Visibility**
  - Visible in config panel
- **Disabled/enabled**
  - Disabled when locked/searching
- **Validation**
  - None
- **Side effects**
  - Shows/hides additional settings

#### 40. Society diversity slider
- **Label/text**
  - Diversity control
- **Type**
  - Slider
- **Where**
  - Advanced society builder
- **What it does**
  - Adjusts society diversity
- **Trigger**
  - Drag/change
- **Reads/writes**
  - custom society controls
- **Visibility**
  - Conditional when advanced builder is open
- **Disabled/enabled**
  - Disabled when locked/searching
- **Validation**
  - Numeric range enforced by slider
- **Side effects**
  - Included in `society_custom_spec`

#### 41. Skeptic ratio slider
- **Label/text**
  - Skeptic ratio
- **Type**
  - Slider
- **Where**
  - Advanced society builder
- **What it does**
  - Adjusts skeptic distribution
- **Trigger**
  - Drag/change
- **Reads/writes**
  - custom society distribution
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Disabled when locked/searching
- **Validation**
  - Slider range
- **Side effects**
  - Included in custom spec

#### 42. Innovation bias slider
- **Label/text**
  - Innovation bias
- **Type**
  - Slider
- **Where**
  - Advanced society builder
- **What it does**
  - Adjusts innovation bias
- **Trigger**
  - Drag/change
- **Reads/writes**
  - custom society controls
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Disabled when locked/searching
- **Validation**
  - Slider range
- **Side effects**
  - Included in custom spec

#### 43. Strict policy toggle
- **Label/text**
  - Strict policy mode
- **Type**
  - Toggle/button
- **Where**
  - Advanced society builder
- **What it does**
  - Enables stricter policy behavior
- **Trigger**
  - Click
- **Reads/writes**
  - custom society controls
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Disabled when locked/searching
- **Validation**
  - Boolean
- **Side effects**
  - Included in custom spec and seed context

#### 44. Human debate toggle
- **Label/text**
  - Human debate style
- **Type**
  - Toggle/button
- **Where**
  - Advanced society builder
- **What it does**
  - Enables a human debate style bias
- **Trigger**
  - Click
- **Reads/writes**
  - custom society controls
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Disabled when locked/searching
- **Validation**
  - Boolean
- **Side effects**
  - Included in custom spec and seed context

#### 45. Persona hint input
- **Label/text**
  - Persona hint
- **Type**
  - Text input
- **Where**
  - Advanced society builder
- **What it does**
  - Lets user guide society/persona composition
- **Trigger**
  - Typing
- **Reads/writes**
  - custom society controls
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Disabled when locked/searching
- **Validation**
  - Free text
- **Side effects**
  - Included in seed/custom context

#### 46. Society copilot question input
- **Label/text**
  - Copilot prompt/question
- **Type**
  - Text input
- **Where**
  - Advanced society builder
- **What it does**
  - Lets user ask for custom society guidance
- **Trigger**
  - Typing
- **Reads/writes**
  - local assistant question state
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Disabled when locked/searching or while copilot busy
- **Validation**
  - Requires non-empty question to be useful
- **Side effects**
  - Used by society assistant endpoint

#### 47. Ask copilot button
- **Label/text**
  - `Ask copilot`
  - Busy label: `Analyzing...`
- **Type**
  - Button
- **Where**
  - Advanced society builder
- **What it does**
  - Calls society assistant for advice
- **Trigger**
  - Click
- **Reads/writes**
  - reads current society builder values and copilot question
  - writes assistant answer
- **Visibility**
  - Conditional when builder is open
- **Disabled/enabled**
  - Disabled when busy, locked, or likely without a question
- **Validation**
  - Free text prompt
- **Side effects**
  - Populates assistant answer block

#### 48. Society copilot answer box
- **Label/text**
  - Generated answer content
- **Type**
  - Answer panel
- **Where**
  - Advanced society builder
- **What it does**
  - Shows custom society guidance
- **Trigger**
  - Society assistant success
- **Reads/writes**
  - Reads assistant answer state
- **Visibility**
  - Conditional when answer exists
- **Disabled/enabled**
  - Non-editable
- **Validation**
  - None
- **Side effects**
  - Informational only

#### 49. Final confirmation section
- **Label/text**
  - `Final confirmation`
- **Type**
  - Section/card
- **Where**
  - Config panel footer
- **What it does**
  - Concentrates final config confirmation
- **Trigger**
  - Always in config panel
- **Reads/writes**
  - `missingFields`, `idea`
- **Visibility**
  - Visible in config mode
- **Disabled/enabled**
  - Child CTA may disable
- **Validation**
  - Uses same missing-fields logic as start confirmation
- **Side effects**
  - None

#### 50. Confirm data button
- **Label/text**
  - `Confirm data`
- **Type**
  - Primary button
- **Where**
  - Config panel footer
- **What it does**
  - Moves config toward confirmed/start-ready state
- **Trigger**
  - Click
- **Reads/writes**
  - pending config review / start orchestration
- **Visibility**
  - Visible in config panel
- **Disabled/enabled**
  - Disabled unless idea is non-empty and `missingFields.length === 0`
- **Validation**
  - Hard-blocked by missing required fields
- **Side effects**
  - Typically leads user back into chat/start pipeline

#### 51. Lock warning block
- **Label/text**
  - Lock reason text
- **Type**
  - Warning block
- **Where**
  - Config panel
- **What it does**
  - Explains why config controls are locked
- **Trigger**
  - `controlsLocked`
- **Reads/writes**
  - lock reason
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Non-interactive
- **Validation**
  - None
- **Side effects**
  - Prevents edits while search/start/locked state is active

### F. Side panel area: ChatPanel / reasoning panel

#### 52. Inline status banner
- **Label/text**
  - Search busy/timeout/error or UI busy stage text
- **Type**
  - Status banner
- **Where**
  - Top of chat panel
- **What it does**
  - Explains current system action
- **Trigger**
  - Search or UI busy states
- **Reads/writes**
  - `searchState`, UI progress flags
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Non-interactive
- **Validation**
  - None
- **Side effects**
  - None

#### 53. Embedded SearchLivePanel
- **Label/text**
  - Live research labels and cards
- **Type**
  - Embedded live activity panel
- **Where**
  - Chat panel when relevant
- **What it does**
  - Shows mandatory research progress/results
- **Trigger**
  - Search stage visibility model
- **Reads/writes**
  - Research sources, search response, pipeline state
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Non-editable
- **Validation**
  - None
- **Side effects**
  - None

#### 54. Debate-ready card
- **Label/text**
  - `Agents have started debating now`
  - `Open reasoning`
- **Type**
  - Info card with CTA
- **Where**
  - Chat panel
- **What it does**
  - Encourages switching to reasoning once debate starts
- **Trigger**
  - Reasoning active or more than one reasoning item exists
- **Reads/writes**
  - Reasoning activity state
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - CTA enabled if reasoning callback exists
- **Validation**
  - None
- **Side effects**
  - Switches to reasoning view

#### 55. Message list
- **Label/text**
  - User/system/agent messages
- **Type**
  - Scrollable message feed
- **Where**
  - Chat panel main body
- **What it does**
  - Primary conversational surface
- **Trigger**
  - New messages/state changes
- **Reads/writes**
  - chat messages local state + simulation chat events
- **Visibility**
  - Always visible in chat/reasoning panel body
- **Disabled/enabled**
  - N/A
- **Validation**
  - None
- **Side effects**
  - Scroll management and option button rendering

#### 56. Message option chips
- **Label/text**
  - Option labels depend on pending field
- **Type**
  - Quick action chips/buttons embedded in messages
- **Where**
  - Inside message items
- **What it does**
  - Lets user answer field selection, location choice, clarification choice, or preflight choice
- **Trigger**
  - Click
- **Reads/writes**
  - various userInput or pause/preflight states
- **Visibility**
  - Conditional when message carries `options`
- **Disabled/enabled**
  - Enabled unless corresponding workflow is busy
- **Validation**
  - Depends on the option type
- **Side effects**
  - Can immediately advance missing-field, preflight, or clarification flows

#### 57. Typing indicator
- **Label/text**
  - `Assistant is responding...`
- **Type**
  - Inline loading indicator
- **Where**
  - Chat panel
- **What it does**
  - Shows assistant reply generation state
- **Trigger**
  - `isThinking`
- **Reads/writes**
  - local thinking state
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - N/A
- **Validation**
  - None
- **Side effects**
  - None

#### 58. Execution error card
- **Label/text**
  - Error text from simulation or chat orchestration
- **Type**
  - Error card
- **Where**
  - Chat panel
- **What it does**
  - Surfaces failures
- **Trigger**
  - Error state populated
- **Reads/writes**
  - simulation error/local errors
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Non-interactive except potential retry elsewhere
- **Validation**
  - None
- **Side effects**
  - None

#### 59. Pending idea confirmation card
- **Label/text**
  - `Is this the final idea framing?`
  - buttons:
    - `Yes, start`
    - `No, I will edit`
- **Type**
  - Confirmation card
- **Where**
  - Chat panel
- **What it does**
  - Forces explicit approval of generated idea framing
- **Trigger**
  - Preflight returns a preferred idea description
- **Reads/writes**
  - `pendingIdeaConfirmation`
  - preflight confirmation key state
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Enabled unless start is busy
- **Validation**
  - User must confirm before simulation start can proceed for that context key
- **Side effects**
  - `Yes` confirms preflight context and restarts start flow
  - `No` returns focus to editing/input

#### 60. Clarification prompt card
- **Label/text**
  - Clarification question and options
- **Type**
  - Prompt card
- **Where**
  - Chat panel
- **What it does**
  - Collects required clarification answers
- **Trigger**
  - Simulation or pre-start clarification pause
- **Reads/writes**
  - `pendingClarification`
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Buttons may disable while submission is busy
- **Validation**
  - Must submit one choice or custom text depending on flow
- **Side effects**
  - Successful answer resumes or advances workflow

#### 61. Preflight prompt card
- **Label/text**
  - Understanding/preflight question and options
- **Type**
  - Prompt card
- **Where**
  - Chat panel
- **What it does**
  - Collects idea understanding answers before research/start
- **Trigger**
  - Preflight gate not clear enough
- **Reads/writes**
  - preflight queue/current question/answers
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Buttons disable while preflight busy
- **Validation**
  - Must choose one option or provide valid custom answer depending on question mapping
- **Side effects**
  - Advances queue or finalizes preflight

#### 62. Pending research review block
- **Label/text**
  - `Review research before continuing`
  - Candidate URL rows
  - `Optional query refinement`
  - `Extra URLs separated by comma`
  - Buttons:
    - `Scrape selected`
    - `Continue search`
    - `Cancel`
- **Type**
  - Review card/form
- **Where**
  - Chat panel
- **What it does**
  - Allows user to influence runtime research evidence gathering
- **Trigger**
  - `pendingResearchReview`
- **Reads/writes**
  - selected URL ids
  - query refinement text
  - extra URLs text
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - `Scrape selected` disabled with no selected URLs or while busy
  - other actions disabled while busy
- **Validation**
  - Added URLs are comma-separated and trimmed
- **Side effects**
  - Calls research action endpoint and may resume/continue evidence collection

#### 63. Post-action chooser
- **Label/text**
  - `Next step after evaluation`
  - Acceptance percentage if available
  - Suggested badge if recommendation exists
  - Buttons:
    - `Make acceptable`
    - `Bring to world`
- **Type**
  - Post-run decision card
- **Where**
  - Chat panel after evaluation
- **What it does**
  - Requests follow-up product strategy actions
- **Trigger**
  - Post actions enabled and simulation sufficiently advanced/completed
- **Reads/writes**
  - final acceptance percentage, post-action request state
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Buttons disable while another post-action is running
- **Validation**
  - None beyond action choice
- **Side effects**
  - Calls post-action endpoint and produces structured recommendation

#### 64. Post-action result block
- **Label/text**
  - Result title
  - Summary
  - `Start follow-up run`
- **Type**
  - Success/result card
- **Where**
  - Chat panel
- **What it does**
  - Presents post-action recommendation and lets user launch follow-up run
- **Trigger**
  - post-action result exists
- **Reads/writes**
  - `postActionResult`
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Follow-up button enabled when callback exists
- **Validation**
  - None
- **Side effects**
  - Starts new simulation with follow-up seed context

#### 65. Quick reply chips
- **Label/text**
  - Contextual replies for pending config review or pending update
- **Type**
  - Chip row
- **Where**
  - Chat panel
- **What it does**
  - Speeds common yes/no/edit responses
- **Trigger**
  - Pending review/update states
- **Reads/writes**
  - Sends predefined message text
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Enabled unless busy
- **Validation**
  - None
- **Side effects**
  - Routes into the same chat message handler as typed input

#### 66. Composer text input
- **Label/text**
  - Input placeholder varies by state/language
- **Type**
  - Textarea/input composer
- **Where**
  - Bottom of chat panel
- **What it does**
  - Main free-text entry point
- **Trigger**
  - Typing and submit
- **Reads/writes**
  - draft text
- **Visibility**
  - Generally visible in chat mode
- **Disabled/enabled**
  - Can be disabled during some busy states
- **Validation**
  - Trimmed non-empty content required for send
- **Side effects**
  - Can drive config extraction, chat discussion, updates, clarification, and start orchestration

#### 67. Composer primary CTA
- **Label/text**
  - Dynamic. Examples include:
    - `Confirm start`
    - `Review idea description first`
    - `Answer questions first`
    - `Retry research`
    - `Use LLM fallback`
    - `Resume reasoning`
    - `Pause reasoning`
    - `Start research/persona preparation`
- **Type**
  - Primary button
- **Where**
  - Composer footer
- **What it does**
  - Executes the highest-priority action for the current state
- **Trigger**
  - Click
- **Reads/writes**
  - Heavily state-dependent
- **Visibility**
  - Always present in composer area
- **Disabled/enabled**
  - Disabled when action is not allowed or busy
- **Validation**
  - Depends on bound action
- **Side effects**
  - Can start research, start simulation, retry search, pause/resume, or submit depending on state

#### 68. Composer secondary action menu
- **Label/text**
  - Contextual actions such as edit config, retry research, use LLM fallback
- **Type**
  - Dropdown menu
- **Where**
  - Composer footer
- **What it does**
  - Exposes lower-priority actions
- **Trigger**
  - Menu open + option click
- **Reads/writes**
  - State-dependent
- **Visibility**
  - Conditional when alternative actions exist
- **Disabled/enabled**
  - Options disable according to current busy/precondition logic
- **Validation**
  - None beyond action preconditions
- **Side effects**
  - Triggers the selected secondary flow

### G. GuidedSimulationPanel inventory

#### 69. Guided shell status bubble
- **Label/text**
  - Stage summary text
- **Type**
  - Status bubble/card
- **Where**
  - Guided side panel
- **What it does**
  - Summarizes current guided stage
- **Trigger**
  - Guided workflow active
- **Reads/writes**
  - `guidedWorkflow.state`
- **Visibility**
  - Conditional when guided workflow shown
- **Disabled/enabled**
  - Non-interactive
- **Validation**
  - None
- **Side effects**
  - None

#### 70. Guided progress chips and inline stats
- **Label/text**
  - Now / Blocked by / Next / Step X/Y / Updated
  - Fast-generated personas note when applicable
- **Type**
  - Meta/status chips
- **Where**
  - Guided side panel
- **What it does**
  - Gives progress and dependency visibility
- **Trigger**
  - Guided workflow state changes
- **Reads/writes**
  - guided workflow metadata
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Non-interactive
- **Validation**
  - None
- **Side effects**
  - None

#### 71. Verification note
- **Label/text**
  - Verification/validation note text
- **Type**
  - Informational note
- **Where**
  - Guided panel
- **What it does**
  - Explains validation or quality state
- **Trigger**
  - When workflow provides it
- **Reads/writes**
  - guided workflow review state
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - N/A
- **Validation**
  - None
- **Side effects**
  - None

#### 72. Context scope choice buttons
- **Label/text**
  - Options from `workflow.context_options`
- **Type**
  - Button group
- **Where**
  - Guided stage `context_scope`
- **What it does**
  - Chooses whether context is specific place/internet/global/etc.
- **Trigger**
  - Click
- **Reads/writes**
  - `draft_context.contextScope`
- **Visibility**
  - Conditional on current stage
- **Disabled/enabled**
  - Disabled when guided workflow is busy/paused
- **Validation**
  - Requires a valid workflow option id
- **Side effects**
  - Changes which subsequent stages/fields become relevant

#### 73. Schema intake wizard controls
- **Label/text**
  - `Collect only missing fields`
  - `Previous`
  - `Next`
  - `Submit fields`
  - `Open config`
  - `Continue` when no fields are missing
- **Type**
  - Wizard form + action buttons
- **Where**
  - Guided stage `schema_intake`
- **What it does**
  - Collects only the missing structured inputs
- **Trigger**
  - Stage active
- **Reads/writes**
  - guided workflow draft context
- **Visibility**
  - Conditional on current stage
- **Disabled/enabled**
  - Depends on current field completeness and pause/busy state
- **Validation**
  - Field-level completion based on guided `required_fields`
- **Side effects**
  - Submits structured schema to guided workflow API

#### 74. Guided clarification questions
- **Label/text**
  - Question prompt(s)
  - `Previous`
  - `Next`
  - `Send answers`
- **Type**
  - Text answer wizard
- **Where**
  - Guided stage `clarification`
- **What it does**
  - Captures clarification answers for guided workflow
- **Trigger**
  - Stage active
- **Reads/writes**
  - clarification answers local state
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Submit/next depend on text presence or wizard position
- **Validation**
  - Answer type is text
- **Side effects**
  - Sends answers to workflow API

#### 75. Guided research activity bubbles
- **Label/text**
  - Active work text and ETA
  - research highlights / location summary / persona previews
- **Type**
  - Activity and preview cards
- **Where**
  - Guided stages `idea_research`, `location_research`, `persona_synthesis`
- **What it does**
  - Shows progress/results while background work runs
- **Trigger**
  - Stage active
- **Reads/writes**
  - workflow review/research/persona snapshot data
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Non-editable
- **Validation**
  - None
- **Side effects**
  - None

#### 76. Guided review summary area
- **Label/text**
  - Review title/summary
  - runtime/persona count/updated chips
  - warnings
  - validation chip
- **Type**
  - Review card
- **Where**
  - Guided stages `review` and `ready_to_start`
- **What it does**
  - Shows consolidated preparation before simulation launch
- **Trigger**
  - Guided review stages
- **Reads/writes**
  - review summary/warnings/persona snapshot
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Child action buttons vary
- **Validation**
  - Workflow readiness controls available actions
- **Side effects**
  - None

#### 77. Persona preview cards
- **Label/text**
  - First two personas with stance, motivation, concern
- **Type**
  - Preview cards
- **Where**
  - Guided review stages
- **What it does**
  - Makes generated personas visible before start
- **Trigger**
  - Persona snapshot available
- **Reads/writes**
  - persona snapshot
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Non-interactive
- **Validation**
  - None
- **Side effects**
  - None

#### 78. Guided primary review/start buttons
- **Label/text**
  - `Approve review`
  - `Start simulation`
  - `Regenerate personas`
  - `Minor edit`
- **Type**
  - Action buttons
- **Where**
  - Guided review/footer area
- **What it does**
  - Approves review, starts simulation, regenerates personas, or opens correction mode
- **Trigger**
  - Click
- **Reads/writes**
  - guided workflow API/state
- **Visibility**
  - Conditional in review/ready stages
- **Disabled/enabled**
  - Depends on workflow status and busy state
- **Validation**
  - Start only available when `canStartSimulation`
- **Side effects**
  - May start actual simulation and attach simulation id to workflow

#### 79. Guided footer controls
- **Label/text**
  - `Pause`
  - `Resume`
  - `Reasoning (count)`
  - `Correction` / `Minor edit`
  - `Rerun` in some correction cases
- **Type**
  - Footer action row
- **Where**
  - Guided panel footer
- **What it does**
  - Controls guided workflow and transitions
- **Trigger**
  - Click
- **Reads/writes**
  - guided workflow pause/resume/correction state
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Depends on workflow state
- **Validation**
  - `Rerun` only when last correction is factual update and simulation is not idle
- **Side effects**
  - May pause workflow or rerun simulation

#### 80. Guided correction composer
- **Label/text**
  - textarea + `Apply correction` + `Cancel`
- **Type**
  - Inline form
- **Where**
  - Guided panel
- **What it does**
  - Lets user submit minor correction/edit to workflow context
- **Trigger**
  - Opened from correction/minor edit action
- **Reads/writes**
  - correction draft text
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Apply disabled when empty or busy
- **Validation**
  - Non-empty text required
- **Side effects**
  - Calls workflow correction endpoint

#### 81. Coach intervention block inside guided panel
- **Label/text**
  - blocker summary
  - guide message
  - severity chip
  - decision axis chip
  - evidence/citations
  - suggestion cards with Apply
  - `More ideas`
  - `Continue`
  - custom fix textarea + `Filter it`
  - patch preview rows + `Confirm rerun`
- **Type**
  - Intervention review surface
- **Where**
  - Guided panel when coach intervention exists
- **What it does**
  - Lets user understand a blocker and choose how to rerun
- **Trigger**
  - Coach intervention enters options-ready state
- **Reads/writes**
  - `coachIntervention`
  - selected suggestion/custom fix
- **Visibility**
  - Conditional
- **Disabled/enabled**
  - Busy-dependent
- **Validation**
  - `Confirm rerun` requires patch preview
- **Side effects**
  - Can trigger coach actions and spawn rerun with patched context

### H. Main arena area

- **SearchPanel**
  - Visible when search-side content is active.
  - Shows mandatory research title/subtitle/status, step list, live events, notes, summaries, result cards, and empty state.
  - Reads `searchState`, research context, search live events, and pipeline state.
  - Non-editable; purely explanatory and progress-oriented.

- **SimulationArena**
  - Visible when not showing the search panel.
  - Contains:
    - network graph of agents and connections
    - info toggle and legend/info card
    - live reasoning CTA
    - recent reasoning snippets on large screens
    - empty state
    - WebGL context lost overlay with `Restart renderer`
  - Reads agents, pulses, metrics, reasoning state.

- **IterationTimeline**
  - Shows `Progress Timeline`, current phase progress, or fallback numeric progress.
  - Maps legacy phase names into canonical display phases.

### I. Metrics panel

- **Metrics headline/description**
  - Derived from `buildSimulationUiState`.
- **Empty state**
  - `Waiting for data`
- **Populated content**
  - overall acceptance card
  - accepted/rejected/neutral mini cards
  - simulation progress bar
  - optional filtered agent sample section
  - optional most-accepting-categories section
- **Visibility**
  - Always rendered as a column/section, but content inside changes by data availability.

### J. Hidden or conditionally revealed elements that still matter

- Reasoning panel content is hidden until reasoning becomes available.
- Config controls lock while searching or when config editing is intentionally blocked.
- Guided panel can replace the normal side panel when a guided workflow is active without attached simulation.
- Search panel can replace the simulation arena during mandatory research/research display.
- Persona source modal and start choice modal are hard blockers in some start paths.
- Clarification/research review/coach intervention states force the page back to chat mode.
- Follow-up/post-action UI appears only after sufficient simulation outcome data exists.

## 4) Full action map

### High-priority actions and observed behavior

#### Open `/simulate`
- Auth required; guest users are redirected to `/?auth=login`.
- Page restores drafts and/or active simulation context from route state, query params, and local storage.
- Session check loading text is `Checking session...`.

#### Send a message before simulation starts
- Composer submission can trigger schema extraction, missing-field prompts, or pending config review.
- If the page is waiting for location choice/city/country, the same message input routes into that specialized branch.
- If extraction fails due to auth, session handling runs. Non-auth failures produce a system message and a busy/retry posture.

#### Confirm pending config review
- Can be triggered from chat or config confirmation UI.
- Re-enters the start pipeline.
- May branch into:
  - missing-field prompts
  - preflight questions
  - pending idea confirmation
  - mandatory research
  - start-path modal
  - persona source modal
  - simulation start

#### Edit config instead of confirming
- Opens config panel.
- Does not clear business state; user is expected to amend existing input rather than restart from scratch.

#### Answer location choice / city / country
- `yes` means location-specific and triggers location capture.
- `no` means proceed without place context.
- Unrecognized location-choice input is rejected and the page asks again.

#### Change config controls
- All config controls update local input.
- Category/audience/goals/risk/maturity changes mark corresponding fields as touched so future extraction cannot overwrite them.
- Controls are blocked when config is locked or search/start is in progress.

#### Open start choices and select a path
- Start path must be selected for the current config key before safe start can continue.
- `build_custom` can later call a custom society build endpoint, but if that build fails the page still attempts to continue with inline custom config.

#### Ask society copilot
- Uses current builder values and the question prompt.
- Shows busy state and then an answer panel if successful.

#### Choose persona source
- Required when the idea is general and no location-derived persona mode is available.
- Can set default audience-only mode, saved place personas, or send user to Persona Lab.

#### Start the simulation
- Preconditions:
  - not already searching/starting/running
  - required fields complete
  - preflight satisfied
  - generated idea framing confirmed when present
  - mandatory research done
  - start path resolved
  - persona source resolved when required
  - credits not blocked
- Impacts:
  - may run extraction
  - may run preflight
  - may run mandatory research
  - may build custom society
  - calls `startSimulation`
- Success:
  - simulation starts
  - user snapshot can be refreshed
- Failure:
  - quota/credits/session/general start error messages are shown

#### Retry mandatory research / use LLM fallback
- Retry increases timeout in steps up to a max.
- LLM fallback is only offered after live search timeout.
- “Start anyway” is explicitly refused; the page retries mandatory research instead.

#### Confirm generated idea framing
- `Yes, start` records the confirmed preflight key and re-enters start logic.
- `No, I will edit` focuses input so the user can change the framing trigger data.

#### Guided workflow actions
- Supported actions from guided panel:
  - choose context scope
  - submit schema
  - answer clarifications
  - approve review
  - pause workflow
  - resume workflow
  - apply correction
  - regenerate personas
  - start simulation when ready

#### Manual pause/resume simulation
- Pause sends `pauseSimulation(simulationId, reason)`.
- Resume sends `resumeSimulation(simulationId)`.
- Resume is only available for specific paused/error reasons declared in page logic.

#### Submit runtime clarification
- Sends selected option/custom text through `submitClarificationAnswer`.
- Success message indicates simulation resumed.

#### Submit runtime research review action
- Actions:
  - `scrape_selected`
  - `continue_search`
  - `cancel_review`
- Includes `researchGateVersion`.
- If backend says action no longer applies, page tells user the state auto-refreshed.

#### Open reasoning tab
- Available from TopBar, chat CTA, arena CTA, and guided footer once reasoning exists.
- Disabled early in the pipeline, with explanatory disabled text.

#### Coach intervention actions
- Open evidence in reasoning tab.
- Request more ideas.
- Continue without change.
- Apply a suggested fix.
- Submit custom fix text for filtering.
- Confirm rerun when patch preview exists.
- Coach confirm rerun:
  - loads current simulation context
  - applies patch
  - preserves research payload
  - starts a new child simulation with `parent_simulation_id`

#### Download report
- Uses a generated-report prompt via general LLM endpoint.
- Downloads `.doc` output.
- Failure is surfaced as `Report generation failed`.

#### Run post-action and start a follow-up run
- Post-action choices:
  - `make_acceptable`
  - `bring_to_world`
- Returned result can provide:
  - title
  - summary
  - revised idea
  - follow-up seed
- Follow-up run re-enters preflight/start logic and uses parent/follow-up seed metadata.

## 5) Business logic and rules

### Validation and gating rules observed in code

- Required start blockers are determined by `getMissingForStart`.
- Start is blocked when any of these are missing:
  - trimmed `idea`
  - `location_choice` when no location exists and the user has not answered whether location matters
  - `city` when the user chose location-specific evaluation but no location is present
  - `category`
  - `target_audience`
  - `goals`
- `ideaMaturity` and `riskAppetite` are part of config and payload building but are not hard blockers in `getMissingForStart`.
- Config confirmation button is disabled unless:
  - `idea.trim().length > 0`
  - `missingFields.length === 0`

### Default values

- `DEFAULT_CATEGORY = 'technology'`
- `DEFAULT_AUDIENCE = ['Consumers']`
- `DEFAULT_GOALS = ['Market Validation']`

### Schema extraction rules

- Free text can be parsed into:
  - idea
  - location
  - category
  - audience
  - goals
  - risk
  - maturity
- Extraction respects touched flags:
  - user-set category/audience/goals/risk/maturity cannot be overwritten by later extraction
- Risk values are normalized whether extraction returns 0..1 or 0..100.

### Preflight / idea understanding rules

- Start flow may call `analyzeIdeaUnderstanding`.
- If idea is clear enough:
  - preflight payload is stored
  - pending idea confirmation is shown
- If idea is not clear enough:
  - questions are mapped into local prompt cards
  - code expects valid questions with exactly 3 options
  - answers are queued one by one
  - after the last answer, `submitIdeaUnderstanding` finalizes the batch
- The user must confirm the generated idea framing before the same context key can start.
- If context changes, previous preflight confirmation becomes stale.

### Mandatory research rule

- Mandatory pre-start research cannot be bypassed.
- Timeout or weak research leads to retry/fallback, not direct simulation start.
- LLM fallback is a provisional substitute only after live research timeout.

### Start-path and persona-source rules

- Current config must resolve a start path:
  - `inspect_default`
  - `build_custom`
  - `start_default`
- If `build_custom` is selected:
  - page may call `buildCustomSociety`
  - if custom build fails, inline custom spec is still used
- General ideas with no location/persona resolution trigger persona source modal.
- Persona source resolution precedence:
  1. explicit override
  2. requested persona source mode
  3. location-driven `generate_new_from_place`
  4. fallback `default_audience_only`

### Credit rules

- User is credits-blocked only if:
  - no daily token remainder exists
  - and `credits <= 0`
- Start is blocked in that state.
- Running sessions can pause with `paused_credits_exhausted`.

### Pause and recovery rules

- Clarification pause requires a pending clarification object.
- Runtime research review pause requires runtime research gate + cycle id.
- Coach pause requires a coach intervention id.
- Any of these pause types force active panel back to chat.
- Resume action is shown only for specific pause/error reasons:
  - `interrupted`
  - `error`
  - `paused_manual`
  - `paused_search_failed`
  - `paused_credits_exhausted`

### Message-mode rules after a simulation exists

- User messages are classified as `discuss` vs `update`.
- If mode detection fails:
  - question mark => discuss
  - otherwise => update
- Discuss mode uses recent reasoning plus research summary.
- Update mode creates a pending update confirmation flow rather than mutating the run immediately.

### Report and post-action rules

- Report generation is prompt-based via general LLM endpoint, not a dedicated report API.
- Post-action supports:
  - `make_acceptable`
  - `bring_to_world`
- Follow-up runs inherit:
  - parent simulation id
  - follow-up seed metadata
  - and then re-enter preflight/start logic

### Assumptions baked into the implementation

- The system assumes a research-backed setup is more important than immediate execution speed.
- The system assumes idea wording quality materially changes simulation quality.
- The system assumes society/persona sourcing is not a trivial visual detail and needs explicit user choice in some cases.
- The system assumes reasoning should appear after setup, not before.

## 6) Data model used by the page

### Core editable data

- `idea: string`
  - product meaning: the idea being evaluated
  - source: local state, drafts, restored runs, guided context
  - editable: yes
  - shown in: composer, config/start context, report prompt
  - depends on it: required-field logic, preflight, research, start

- `category: string`
  - meaning: business/product category
  - source: user selection or extraction
  - editable: yes
  - example: `technology`
  - shown in: config, payload
  - depends on it: research query, payload, defaults

- `targetAudience: string[]`
  - meaning: intended audience segments
  - source: user selection or extraction
  - editable: yes
  - example: `['Consumers']`
  - shown in: config and payload
  - depends on it: payload, persona framing, missing-field logic

- `country: string`, `city: string`, `placeName?: string`
  - meaning: geographic or place context
  - source: user input, extraction, restored state, guided context
  - editable: city/country yes; placeName indirect
  - examples: `Egypt`, `Cairo`
  - shown in: config, report prompt, guided review
  - depends on them: location logic, research query, persona source defaults

- `riskAppetite: number`
  - meaning: risk tolerance level
  - source: slider or extraction
  - editable: yes
  - UI scale: 0..100
  - payload transform: 0..1

- `ideaMaturity: 'concept' | 'prototype' | 'mvp' | 'launched'`
  - meaning: stage of the idea/product
  - source: user selection or extraction
  - editable: yes

- `goals: string[]`
  - meaning: evaluation goals
  - source: user selection or extraction
  - editable: yes
  - example: `['Market Validation']`

- `agentCount?: number`
  - meaning: number of agents to simulate
  - source: slider
  - editable: yes
  - intended range: 5..500

### Start payload data (`SimulationConfig`)

- Carries:
  - idea fields
  - location fields and derived `location`
  - normalized risk
  - goals/audience/maturity
  - language
  - simulation speed
  - research summary/sources/structured data
  - start path
  - society mode/profile/custom spec
  - persona source mode/set
  - preflight readiness/summary/answers/score/assumptions
  - parent/follow-up metadata
  - seed context for guided or coach reruns

### Runtime data used by the page

- `SimulationStateResponse`
  - status/status_reason
  - pending input flags
  - schema
  - persona source resolution
  - pipeline steps/blockers
  - phase/progress
  - clarification payload
  - runtime research review payload
  - coach intervention
  - metrics
  - agents
  - reasoning
  - chat events
  - research sources
  - summary
  - error

- `SimulationMetrics`
  - `totalAgents`
  - `accepted`
  - `rejected`
  - `neutral`
  - `acceptanceRate`
  - `polarization`
  - `currentIteration`
  - `totalIterations`
  - `perCategoryAccepted`

- `Agent`
  - id, status, position, connections, category, lastUpdate

- `ReasoningMessage`
  - agent identity
  - message
  - timestamp
  - iteration/phase
  - stance/opinion metadata
  - confidence/policy metadata

- `SimulationChatEvent`
  - system/user/research/status events for chat timeline

- `PendingClarification`
  - question, options, reason summary, affected agents, support snippets, quality info

- `PendingResearchReview`
  - cycle id, candidate URLs, quality snapshot, gap summary, suggested queries

- `CoachIntervention`
  - blocker summary
  - severity
  - decision axis
  - guide message
  - evidence
  - suggestions
  - patch preview
  - custom fix
  - history/resolution

- `GuidedWorkflowState`
  - workflow id
  - status/stage
  - ETA
  - required fields
  - context options
  - draft context
  - guide messages
  - stage history
  - research/review/persona snapshot/correction data

### Request/response shapes explicitly used

- `startSimulation` response
  - `simulation_id`
  - `status`
  - `status_reason`

- `analyzeIdeaUnderstanding` response
  - `clear_enough`
  - `clarity_score`
  - `missing_axes`
  - `questions`
  - `preferred_idea_description`
  - `summary`

- `submitIdeaUnderstanding` response
  - `preferred_idea_description`
  - `summary`
  - `confirm_required`
  - `preflight_ready`
  - `preflight_answers`
  - `preflight_clarity_score`
  - `assumptions`

- `runPrestartResearch` response
  - `summary`
  - `highlights`
  - `gaps`
  - `confirm_start_required`
  - plus result/source/structured fields used by UI models

### Local derived structures

- derived location string
- search panel model
- `SimulationUiState`
- filtered agent sample lists
- current-context keys used to invalidate stale confirmations/reviews

## 7) State matrix

- **Initial / empty**
  - Header, TopBar, empty workspace shell
  - user can enter idea or edit config

- **Auth checking**
  - only `Checking session...`
  - no actions

- **Prefilled draft**
  - idea/context already loaded
  - user can review, edit, or continue

- **Missing-input**
  - chat prompts and config highlights appear
  - user answers missing items or edits config

- **Pending config review**
  - user confirms or edits

- **Preflight question**
  - one structured idea-understanding question at a time

- **Pending idea confirmation**
  - generated framing must be accepted or edited

- **Mandatory research running**
  - live research panel/progress visible

- **Research timeout / weak research**
  - retry and LLM fallback actions visible

- **Pending runtime research review**
  - candidate URLs, refinement input, scrape/continue/cancel actions

- **Start-choice modal open**
  - explicit society-path decision required

- **Persona-source modal open**
  - explicit persona-sourcing decision required

- **Guided workflow stage states**
  - `context_scope`
  - `schema_intake`
  - `clarification`
  - `idea_research`
  - `location_research`
  - `persona_synthesis`
  - `review`
  - `ready_to_start`

- **Running simulation**
  - arena, metrics, reasoning-availability progression, pause controls

- **Paused clarification**
  - banner + clarification prompt

- **Paused research review**
  - banner + review card

- **Paused coach intervention**
  - banner + intervention options + rerun flow

- **Paused manual**
  - resume available

- **Paused credits exhausted**
  - credit warning and resume-later path

- **Completed**
  - metrics, report export, post-action, follow-up

- **Error**
  - error text and possibly resume if backend allows

- **No permission**
  - not an in-page state; route redirects guests

## 8) API / store / state dependencies

### Frontend dependencies

- `useSimulation`
  - primary simulation lifecycle source
  - manages websocket + polling + pause/resume + review/intervention actions
- `useGuidedWorkflow`
  - primary guided workflow source
  - manages guided polling and stage actions
- `ThemeContext`
  - theme state and persistence
- `LanguageContext`
  - language state, translation selection, RTL/LTR behavior
- local storage
  - `activeSimulationId`
  - `activeGuidedWorkflowId`
  - `pendingSimulationDraft`
  - `pendingIdea`
  - `pendingAutoStart`
  - `dashboardIdea`
  - `appSettings`
- URL/query state
  - `simulation_id`

### API endpoints used by this page/service layer

- `POST /simulation/start`
- `POST /simulation/understanding/analyze`
- `POST /simulation/understanding/submit`
- `POST /simulation/research/prestart`
- `POST /simulation/pause`
- `POST /simulation/resume`
- `POST /simulation/clarification/answer`
- `POST /simulation/research/action`
  - backend route wrapper not confirmed from scanned backend files
- `POST /simulation/coach/respond`
  - backend route wrapper not confirmed from scanned backend files
- `POST /simulation/post-action`
  - backend route wrapper not confirmed from scanned backend files
- guided workflow endpoints under `/simulation/workflow/*`
- persona library endpoint under `/simulation/persona-lab/library`
- society endpoints:
  - `GET /society/catalog`
  - `POST /society/custom/build`
  - `POST /society/custom/assistant`
  - backend wrappers for build/assistant not confirmed from scanned backend files
- websocket:
  - `/ws/simulation`

### UI blocked/unblocked implications

- Auth guard blocks the route before page entry.
- Start is blocked by missing inputs, preflight, research, start choice, persona source, or credits.
- Config editing is blocked while config is locked/searching.
- Reasoning is blocked until enough simulation progress exists.
- Guided start is blocked until workflow reports ready state.

## 9) Error handling and edge cases

### Observed in code

- Missing required inputs cause explicit re-prompts.
- Unrecognized yes/no location answers are rejected and re-asked.
- Extraction auth failures trigger session-expired handling.
- Non-auth extraction failures produce “LLM busy” style messaging.
- Mandatory research timeout leads to retry/fallback, not bypass.
- Empty/weak research is treated as unusable.
- Start while already searching/starting/running is blocked.
- Previous runs are explicitly stopped before fresh start when necessary.
- Runtime research action can return stale-state response; page handles that case.
- Coach rerun cannot proceed without patch preview.
- Report generation failure is surfaced to the user.
- WebGL renderer loss has explicit recovery action.
- Realtime disconnect/reconnect is visible in header.

### Likely weak areas inferred from structure

- The route is very state-dense, so stale-state or branch-combination complexity is a real risk.
- Some advanced frontend flows rely on backend route wrappers that were not confirmed in the scanned backend files.
- Report export depends on generated text quality because it is not server-rendered from a stable report object.
- The dynamic primary CTA is easy to misread if the redesign removes strong contextual cues.

### Not confirmed from code

- No explicit analytics instrumentation was found.
- No full offline mode was found beyond reconnecting/error/retry behavior.
- No dedicated destructive “discard current simulation” confirmation flow was found.

## 10) Current UX issues / technical constraints

### Observed in code

- `frontend/src/pages/Index.tsx` coordinates many local states and branches.
- The same page mixes setup, live run, remediation, export, and follow-up.
- Primary CTA meaning changes frequently.
- Some important business steps are expressed mainly through chat messages rather than dedicated layout structure.
- Modal gates are essential to logic, not optional decoration.

### Likely UX problems inferred from structure

- The page likely feels overloaded.
- It is easy to lose track of “what stage am I in?”.
- Chat is carrying too much orchestration responsibility.
- Advanced capabilities like coach reruns or society customization can be visually buried.

### Areas where redesign must preserve behavior carefully

- Preflight clarification and generated-idea confirmation
- Mandatory research
- Start-path selection
- Persona-source selection for general ideas
- Runtime pause-type distinctions
- Guided workflow stage semantics
- Coach rerun behavior
- Restored draft/run continuity

### Areas that can likely be improved visually without changing logic

- hierarchy
- section grouping
- CTA prominence
- visual separation of setup vs run vs remediation
- readability of warnings and blockers
- empty/loading/error presentation

### Technical constraints

- Auth remains route-level.
- Theme and language are global context-driven.
- RTL/LTR must remain correct.
- Search and simulation are async and can overlap in user perception.
- Realtime status must still surface somewhere.

## 11) Design system alignment

### Shared visual language observed in code

- grayscale-first palette
- glass-panel surfaces with blur and subtle borders
- large rounded containers and pill controls
- semantic status colors:
  - green success/acceptance
  - red destructive/rejection
  - amber warning/active exchange
  - slate neutral
- typography centered on:
  - `Cairo`
  - `Outfit`
  - `IBM Plex Sans Arabic`
  - `Be Vietnam Pro`
  - `Readex Pro`
  - `JetBrains Mono` for meta/mono use
- generous spacing rather than dense enterprise layouts
- Lucide-style iconography
- descriptive empty/loading/error states

## Non-negotiable visual alignment constraints

- Keep the redesigned page inside the existing grayscale + glass-panel design system.
- Preserve semantic color meaning for acceptance/rejection/neutral/warning states.
- Preserve large rounded surfaces and pill-shaped controls.
- Preserve bilingual RTL/LTR behavior.
- Follow existing component patterns where possible.
- Improve clarity, but do not make the page look like a different product.

## 12) What Stitch must preserve exactly

- MUST preserve the page as an authenticated simulation workspace.
- MUST preserve mandatory research as mandatory.
- MUST preserve preflight clarification and generated-idea confirmation.
- MUST preserve required-field gating for idea, location choice, city when needed, category, audience, and goals.
- MUST preserve extraction-without-overwriting-touched-fields behavior.
- MUST preserve start-path selection and advanced society builder behavior.
- MUST preserve persona-source selection for general ideas.
- MUST preserve guided workflow stages and meaning.
- MUST preserve pause distinctions and their recovery actions.
- MUST preserve reasoning availability gating.
- MUST preserve coach intervention review/apply/rerun behavior.
- MUST preserve runtime research review actions.
- MUST preserve report download and post-action/follow-up flows.
- MUST preserve restored draft/simulation continuity.
- MUST preserve credit warning/blocking behavior.
- MUST preserve RTL/LTR correctness and keyboard-usable controls.

## 13) What Stitch is allowed to improve

- layout
- grouping
- spacing
- hierarchy
- CTA clarity
- card structure
- progressive disclosure
- readability
- scanability
- empty/loading/error presentation
- responsive behavior

Business logic, functional completeness, user meaning, and validation cannot be changed.

## 14) Stitch-ready redesign brief

Google Stitch,

Redesign `/simulate` as the product’s primary idea-evaluation workspace for authenticated users. This page must support the full lifecycle already present in code: idea intake, missing-field completion, preflight clarification, generated-idea confirmation, mandatory pre-start research, persona/society setup, simulation start, live reasoning review, runtime pauses, coach interventions, report export, and follow-up actions.

Optimize for clarity, stage awareness, and decision confidence. The redesign should make it obvious whether the user is still preparing the idea, waiting for required research, in a live simulation, or resolving a pause/intervention. Use stronger information hierarchy and cleaner grouping, but do not remove any state or shortcut any gate.

Functionally, preserve all business logic: mandatory research, preflight confirmation, required-field validation, start-path selection, persona-source selection, advanced society builder inputs, pause-type-specific recovery flows, coach reruns, export, post-action recommendations, and restored-draft/restored-simulation behavior.

Visually, keep the page native to the current system: grayscale-first palette, glass-panel surfaces, large rounded containers, semantic status colors, badge-heavy status treatment, and bilingual RTL/LTR support. Improve structure and scanability without making the page feel like a new product.

## 15) Evidence appendix

### Relevant source files

- `frontend/src/App.tsx`
  - route path, auth guard, app providers
- `frontend/src/pages/Index.tsx`
  - main orchestration and state logic
- `frontend/src/hooks/useSimulation.ts`
  - runtime simulation lifecycle
- `frontend/src/hooks/useGuidedWorkflow.ts`
  - guided workflow lifecycle
- `frontend/src/components/Header.tsx`
  - page header, realtime status, settings
- `frontend/src/components/TopBar.tsx`
  - stage/status/panel controls
- `frontend/src/components/ConfigPanel.tsx`
  - config fields and society builder
- `frontend/src/components/ChatPanel.tsx`
  - chat orchestration, prompt cards, post actions
- `frontend/src/components/GuidedSimulationPanel.tsx`
  - guided workflow UI and coach intervention presentation
- `frontend/src/components/SearchPanel.tsx`
  - research presentation
- `frontend/src/components/chat/SearchLivePanel.tsx`
  - live research progress/result UI
- `frontend/src/components/SimulationPanel.tsx`
  - overall simulation composition
- `frontend/src/components/SimulationArena.tsx`
  - graph visualization and renderer recovery
- `frontend/src/components/IterationTimeline.tsx`
  - phase/iteration timeline
- `frontend/src/components/MetricsPanel.tsx`
  - metrics and filtered samples
- `frontend/src/types/simulation.ts`
  - core page data contracts
- `frontend/src/services/api.ts`
  - service contracts and endpoint usage
- `frontend/src/lib/simulationUi.ts`
  - page status/title/graph/metrics copy mapping
- `frontend/src/lib/searchPanelModel.ts`
  - research model mapping
- `backend/app/api/routes.py`
  - core simulation and research routes
- `backend/app/api/guided_workflow.py`
  - guided workflow routes
- `backend/app/api/persona_lab.py`
  - persona library routes
- `backend/app/api/websocket.py`
  - websocket route and access control
- `frontend/src/index.css`
  - fonts, tokens, glass-panel styling, theme variables, RTL defaults
- `frontend/tailwind.config.ts`
  - token wiring, colors, animation, radius config

### Other pages inspected for visual consistency

- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/pages/AdminDashboard.tsx`
- `frontend/src/pages/AgentResearchScreen.tsx`
- `frontend/src/pages/IdeaCourtPage.tsx`
- `frontend/src/pages/BonusPage.tsx`
- `frontend/src/pages/SettingsPage.tsx`
- `frontend/src/components/dashboard/HomeTab.tsx`
- `frontend/src/components/dashboard/ResearchTab.tsx`
- `frontend/src/components/dashboard/PersonaLabTab.tsx`
- `frontend/src/components/dashboard/SimulationDetails.tsx`

### Explicit “Not confirmed from code”

- Matching backend HTTP route implementations were not located in scanned backend files for:
  - `POST /simulation/research/action`
  - `POST /simulation/coach/respond`
  - `POST /simulation/post-action`
  - `POST /society/custom/build`
  - `POST /society/custom/assistant`
- Frontend service contracts and domain models for these flows do exist.
- Backend coach-domain support is also visible in public state models.
- Conclusion:
  - these flows are represented on the frontend and in shared models,
  - but the exact backend route wrappers for some of them are **Not confirmed from code** in the scanned backend files.
