#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Build WINEK - a hyperlocal, tag-based connection platform focused on sports and coaching.
  V1 features: Users can create/search geo-located "tagPoints", coaches can offer paid services,
  integrated Stripe payments, bilingual (FR/EN), Google + email/password auth.
  Stack: FastAPI + PostgreSQL + PostGIS (migrated from MongoDB), Expo React Native frontend.
  User language: French.

backend:
  - task: "PostgreSQL + PostGIS database setup and migration"
    implemented: true
    working: true
    file: "/app/backend/database.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Migrated from MongoDB to PostgreSQL + PostGIS. All tables created with spatial indexes. Seeded with demo data (4 domains, 28 tags, 3 users, 4 tagpoints, 1 service). Verified via curl: domains, login, geo-search all working."

  - task: "Auth API - register, login, Google OAuth"
    implemented: true
    working: true
    file: "/app/backend/routes/auth_routes.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: "Implemented register (email/password), login, Google OAuth via Emergent session. Tested login for user@winek.app - returns JWT token successfully."

  - task: "TagPoints API with PostGIS geo-search"
    implemented: true
    working: true
    file: "/app/backend/routes/tagpoint_routes.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: "Implemented with ST_DWithin for radius search, ST_MakePoint for insertion, precision masking, domain/tag filtering. Returns 4 results near Paris center in tests."

  - task: "Services API (coach offerings)"
    implemented: true
    working: true
    file: "/app/backend/routes/service_routes.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: "CRUD for coach services with geo-search using PostGIS. Enriches with coach info and reviews."

  - task: "Bookings API"
    implemented: true
    working: true
    file: "/app/backend/routes/booking_routes.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: "Booking creation with commission calculation (15%), status management, enriched with service and coach info."

  - task: "Domains/Tags API"
    implemented: true
    working: true
    file: "/app/backend/routes/domain_routes.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Verified via curl - returns 4 domains correctly."

  - task: "Payment API with Stripe"
    implemented: true
    working: "NA"
    file: "/app/backend/routes/payment_routes.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Implemented with emergentintegrations Stripe. Uses test key from environment. Not fully tested - needs end-to-end test."

frontend:
  - task: "Login screen (email/password + Google)"
    implemented: true
    working: true
    file: "/app/frontend/app/(auth)/login.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Verified with screenshot - login screen shows correctly at /login URL. Email/password form + Google login button. Successfully tested login with user@winek.app."

  - task: "Register screen"
    implemented: true
    working: true
    file: "/app/frontend/app/(auth)/register.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: "Register screen with name, email, password + language selector (FR/EN) + Google option."

  - task: "Map screen with TagPoints (Leaflet/WebView)"
    implemented: true
    working: true
    file: "/app/frontend/app/(tabs)/map.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Map screen works on web using iframe fallback (MapViewComponent updated). Shows 2 TagPoints near Paris. Domain filter pills working. Bottom tab navigation visible."

  - task: "Search screen with radius and domain filter"
    implemented: true
    working: true
    file: "/app/frontend/app/(tabs)/search.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Verified - shows TagPoints (2) and Coachs (1) tabs, radius selector (1-50km), domain filter, search bar."

  - task: "Create TagPoint screen"
    implemented: true
    working: true
    file: "/app/frontend/app/(tabs)/create.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: "Create TagPoint form with map location picker, title, description, domain, tags, precision, expiry. Needs full E2E test."

  - task: "Profile screen with language switching"
    implemented: true
    working: true
    file: "/app/frontend/app/(tabs)/profile.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Verified with screenshot - shows user info, language switcher (FR/EN), Devenir Coach button, My TagPoints, logout."

  - task: "Bookings screen"
    implemented: true
    working: true
    file: "/app/frontend/app/(tabs)/bookings.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: "Bookings list screen with my bookings / coach bookings tabs."

  - task: "MapViewComponent web fallback (iframe)"
    implemented: true
    working: true
    file: "/app/frontend/components/MapViewComponent.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: "Updated to use iframe on web (Platform.OS === web) and WebView on native. Conditional import to avoid WebView error on web."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: true

test_plan:
  current_focus:
    - "Login screen (email/password + Google)"
    - "Register screen"
    - "Map screen with TagPoints (Leaflet/WebView)"
    - "Search screen with radius and domain filter"
    - "Create TagPoint screen"
    - "Profile screen with language switching"
    - "MapViewComponent web fallback (iframe)"
  stuck_tasks: []
  test_all: true
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Complete MVP implementation done:
      1. MIGRATED backend from MongoDB to PostgreSQL + PostGIS
      2. Created all auth screens (login, register, google callback)
      3. Created all tab screens (map, search, create, bookings, profile)
      4. MapViewComponent updated with web iframe fallback
      5. Backend seeded with demo data (Paris tagpoints, coach, services)
      
      CREDENTIALS FOR TESTING:
      - Admin: admin@winek.app / WinekAdmin2024!
      - Coach: coach@winek.app / WinekCoach2024!
      - User: user@winek.app / WinekUser2024!
      
      FRONTEND URL: https://winek-local-1.preview.emergentagent.com
      BACKEND URL: https://winek-local-1.preview.emergentagent.com/api
      
      Test all high priority features. Note: Stripe payment test not critical for MVP verification.
