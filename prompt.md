
# MASTER DEVELOPMENT PROMPT

## Family Construction Management & Financial Platform

You are the lead software architect, senior full-stack engineer, mobile engineer, Firebase engineer, UI/UX engineer, QA engineer, and AI engineer for this project.

Your job is to design and build a production-quality construction business management platform for a family-owned construction business.

Do NOT rush into coding.

First understand the requirements, create the architecture and implementation plan, then execute the project phase-by-phase.

---

# 1. PRODUCT VISION

Build a simple, reliable, mobile-first construction business management platform that digitizes:

* Construction projects
* Clients
* Contracts
* BOQ / quotation / rate cards
* Work measurements
* Monthly billing
* Client payments
* Labour management
* Labour attendance
* Labour wage calculation
* Labour payments
* Expenses
* Project financials
* Cash flow
* Reports
* Documents
* Hindi/English language support
* AI assistant
* Voice-based AI assistant

The primary user is the business owner/father.

The application must be simple enough for a non-technical person to use.

The owner should be able to ask questions in Hindi or English using voice instead of navigating through complicated menus.

Example:

"टाटा प्रोजेक्ट में कितना पैसा आया है?"

"Tata Project mein kitna paisa aaya hai?"

"How much money have we received from Tata Project?"

All three should result in the same business query.

---

# 2. MOST IMPORTANT BUSINESS REQUIREMENT

This is NOT simply an attendance application.

It is a construction project + measurement + billing + labour + finance management system.

The central business relationship is:

Client
→ Project
→ Contract / BOQ
→ Work Measurement
→ Monthly Bill
→ Client Payment

And:

Project
→ Labour
→ Attendance
→ Wage Calculation
→ Labour Payment

And:

Project
→ Expenses
→ Project Financial Summary

Everything must eventually come together into a project-level financial view.

---

# 3. REAL BUSINESS EXAMPLE

Use the following as the initial seed/development example.

Project:

Tata Project Limited - Agra

Client:

Stonede

Client Contact:

Rakesh Rao

Contract Value:

₹18,50,000

Current received amount:

₹10,00,000

Current outstanding:

₹8,50,000

Current labour cost:

₹4,20,000

IMPORTANT:

The above values are examples/current business information.

The application must NOT simply store these as hardcoded values.

The system must calculate:

* Total billed
* Total received
* Outstanding
* Labour earned
* Labour paid
* Labour payable
* Project expenses
* Project financial position

from actual underlying transactions.

---

# 4. CONTRACT AND BILLING MODEL

The contract value is based on work.

The business has agreed rates for different types of work.

Billing happens according to:

Work Type
+
Measurement/Area/Quantity
+
Agreed Rate

Example:

Flooring
2500 Sq.ft
× ₹120
========

₹3,00,000

The system must support:

* Work item
* Description
* Unit
* Contract quantity
* Rate
* Contract amount
* Previously completed quantity
* Current quantity
* Total completed quantity
* Remaining quantity
* Current bill amount

The system must prevent accidental overbilling.

Business rule:

Previously completed quantity + current quantity <= contract quantity

unless an authorized user explicitly approves an additional quantity/change order.

---

# 5. BOQ / RATE CARD

Each project can have multiple BOQ items.

Example:

Flooring
Unit: Sq.ft
Contract Quantity: 10,000
Rate: ₹120

Plaster
Unit: Sq.ft
Contract Quantity: 5,000
Rate: ₹45

Painting
Unit: Sq.ft
Contract Quantity: 8,000
Rate: ₹35

The actual values must be configurable.

Never hardcode sample rates into business logic.

---

# 6. MEASUREMENT BOOK

Create a Measurement Book module.

Users must be able to create monthly measurements.

Example:

August 2026

Flooring
Block A
2500 Sq.ft

The system calculates:

2500 × ₹120 = ₹3,00,000

Each measurement should contain:

* Project ID
* BOQ item ID
* Date
* Month
* Location
* Description
* Quantity
* Unit
* Rate
* Calculated amount
* Entered by
* Created timestamp
* Updated timestamp
* Status

Measurement statuses:

* Draft
* Submitted
* Approved
* Rejected

Only approved measurements should be eligible for final billing.

---

# 7. BILLING

Create monthly bills from approved measurements.

Bill should contain:

* Project
* Client
* Bill number
* Bill date
* Billing period
* Measurement references
* Subtotal
* Taxes if applicable
* Deductions if applicable
* Net amount
* Status
* PDF document reference

Bill statuses:

* Draft
* Generated
* Sent
* Partially Paid
* Paid
* Cancelled

Do not delete financial records.

Use cancellation/reversal/audit mechanisms.

---

# 8. CLIENT PAYMENTS

The client pays into the business bank account.

The platform must maintain a client payment ledger.

Each payment should contain:

* Project
* Client
* Amount
* Date
* Payment method
* Bank reference
* Transaction ID
* Source
* Attachment
* Status
* Created by
* Created timestamp

Payment statuses:

* Pending
* Suggested
* Confirmed
* Rejected
* Reversed

Important:

Billed amount != received amount.

Example:

Contract:
₹18,50,000

Billed:
₹10,00,000

Received:
₹7,00,000

Outstanding:
₹3,00,000

Do not calculate outstanding directly from contract value.

Maintain:

Contract Value
Total Billed
Total Received
Receivable

as separate concepts.

---

# 9. PAYMENT INGESTION

Future/optional payment ingestion methods:

1. Manual entry
2. Bank statement CSV/Excel upload
3. Screenshot/image upload
4. Email parsing
5. SMS parsing if technically and platform-policy feasible

DO NOT make SMS access mandatory.

For the first version, prioritize:

Manual entry
+
Bank statement upload
+
Screenshot upload

AI can extract:

* Amount
* Date
* Sender
* Bank reference
* Transaction reference
* Description

But extracted transactions must initially be treated as suggestions.

Never automatically finalize a financial transaction solely because AI extracted it.

Workflow:

Upload
→ Extract
→ Match
→ Show candidate
→ Human confirms
→ Save transaction

---

# 10. LABOUR MANAGEMENT

Each labourer has a profile.

Fields:

* Name
* Phone
* Role
* Skill
* Daily wage
* Overtime rate if required
* Status
* Joining date
* Notes

Avoid collecting unnecessary sensitive personal information.

Do not require Aadhaar unless explicitly required later.

---

# 11. PROJECT-LABOUR ASSIGNMENT

A labourer can work on different projects over time.

Therefore do NOT simply store project ID permanently inside labour.

Create a project-labour assignment structure.

Fields:

* Labour ID
* Project ID
* Start date
* End date
* Daily rate for this project
* Status

This allows historical project assignments.

---

# 12. ATTENDANCE

Attendance is one of the primary features.

Daily attendance should be extremely fast.

Example:

Tata Project
27-Aug-2026

Ramesh — Present
Suresh — Present
Mohan — Absent
Rahul — Half Day

Statuses:

* Present
* Absent
* Half Day
* Leave
* Holiday

Allow configurable attendance rules.

Attendance must record:

* Labour
* Project
* Date
* Status
* Hours if required
* Marked by
* Timestamp

Prevent duplicate attendance for the same:

Project + Labour + Date

unless explicitly edited by an authorized user.

---

# 13. OFFLINE ATTENDANCE

Construction sites may have poor internet.

The mobile app MUST support offline attendance.

Required behavior:

Internet available:
→ Save/sync to Firestore

Internet unavailable:
→ Save locally

Internet returns:
→ Synchronize automatically

Handle:

* Duplicate sync
* Conflicts
* Failed synchronization
* Retry
* Timestamp
* User identity

Do not lose attendance because of network failure.

---

# 14. WAGE CALCULATION

Labour cost should be calculated from attendance.

Example:

Daily wage = ₹700

Present = 23
Half Day = 2

Payable days = 24

Wage:

# 24 × ₹700

₹16,800

The exact half-day calculation must be configurable.

Create a deterministic wage calculation service.

DO NOT use AI to calculate wages.

AI may explain the result, but the calculation must come from deterministic application logic.

---

# 15. LABOUR PAYMENTS

Labour payment is different from labour earned.

Example:

Earned:
₹20,000

Already paid:
₹12,000

Payable:
₹8,000

Track:

* Labour
* Project
* Wage period
* Earned amount
* Payment amount
* Payment date
* Method
* PhonePe transaction ID
* Bank transaction ID
* Screenshot/receipt
* Status

Payment methods:

* PhonePe
* Cash
* Bank Transfer
* Other

The application should NOT directly execute PhonePe payments in V1.

It should record and track payments made through PhonePe.

---

# 16. EXPENSE MANAGEMENT

Allow project expenses.

Categories:

* Labour
* Material
* Transport
* Equipment
* Food
* Accommodation
* Miscellaneous
* Other

Every expense should contain:

* Project
* Category
* Amount
* Date
* Description
* Payment method
* Receipt/document
* Created by

---

# 17. PROJECT FINANCIAL SUMMARY

Every project should have a financial summary.

Example:

Contract Value
₹18,50,000

Total Billed
₹10,00,000

Total Received
₹10,00,000

Client Outstanding
₹8,50,000

Labour Earned
₹4,20,000

Labour Paid
₹3,70,000

Labour Payable
₹50,000

Other Expenses
₹X

Project financial position
₹X

Do not call this "profit" unless the calculation includes all required costs and accounting rules.

Use a clear distinction between:

* Revenue/Billing
* Cash Received
* Labour Cost
* Expenses
* Cash Outflow
* Receivables
* Payables
* Estimated Margin
* Actual Profit if sufficient data exists

---

# 18. FINANCIAL LEDGER

Every financial event should be traceable.

Examples:

Client payment
Labour payment
Expense
Bill
Adjustment

Create a transaction/ledger model.

Every transaction must have:

* ID
* Project
* Type
* Amount
* Date
* Reference
* Source
* Related entity
* Created by
* Timestamp
* Status

Do not silently mutate financial history.

---

# 19. AUDIT LOG

Create an audit log.

Track important actions:

* Bill created
* Bill edited
* Bill cancelled
* Payment created
* Payment edited
* Payment reversed
* Attendance changed
* Wage rate changed
* Expense created
* User permissions changed

Store:

* User
* Action
* Entity
* Entity ID
* Old value where appropriate
* New value
* Reason where appropriate
* Timestamp

---

# 20. USER ROLES

Implement RBAC.

Roles:

OWNER
ADMIN
SUPERVISOR
ACCOUNTANT
VIEWER

Suggested permissions:

OWNER:
Full access

ADMIN:
Operational + management access

SUPERVISOR:
Projects
Labour
Attendance
Measurements

ACCOUNTANT:
Bills
Payments
Expenses
Financial reports

VIEWER:
Read-only

Financial write operations must be protected.

---

# 21. TECHNOLOGY STACK

The primary requirement is:

## KEEP THE INITIAL DEPLOYMENT AT ₹0

Do NOT introduce paid infrastructure without explicit approval.

Do NOT automatically use:

* Cloud Run
* Cloud SQL
* Cloud Functions
* Supabase
* AWS
* Azure
* Vercel
* paid backend hosting

unless explicitly approved.

---

# 22. FIREBASE-FIRST ARCHITECTURE

Use Firebase services wherever possible.

Primary services:

Firebase Authentication
Firebase Firestore
Firebase Storage
Firebase Hosting
Firebase Cloud Messaging
Firebase Analytics where useful
Firebase Crashlytics for mobile where useful
Firebase AI Logic / Gemini integration where appropriate

Initial architecture:

Web:
React + Vite + TypeScript

Mobile:
React Native + Expo + TypeScript

Database:
Cloud Firestore

Files:
Firebase Storage

Authentication:
Firebase Authentication

Hosting:
Firebase Hosting

AI:
Gemini/Firebase AI integration where appropriate

---

# 23. FIRESTORE

Use Firestore as the initial database because the project must remain Firebase-first and free/no-cost within quotas.

Design Firestore carefully.

Potential collections:

users
clients
projects
projectMembers
boqItems
measurements
measurementItems
bills
billItems
clientPayments
labour
labourAssignments
attendance
wageCalculations
labourPayments
expenses
transactions
documents
notifications
auditLogs

Avoid inefficient queries.

Do NOT repeatedly load the entire database for dashboards.

Use summary documents where appropriate.

Example:

projects/{projectId}/summary/current

Possible fields:

contractValue
totalBilled
totalReceived
clientOutstanding
labourCost
labourPaid
labourPayable
otherExpenses

These summaries must be updated transactionally or through safe deterministic logic.

---

# 24. FIRESTORE DATA CONSISTENCY

Financial calculations must be reliable.

Use:

* Firestore transactions
* Batched writes
* Server timestamps where appropriate
* Validation
* Security rules
* Idempotency where required

Do not rely only on frontend validation.

Where Firestore limitations make a requirement unsafe, document the limitation instead of pretending it is solved.

---

# 25. FIREBASE SECURITY RULES

Security rules are mandatory.

Do NOT use:

allow read, write: if true;

Do not expose the database publicly.

Implement:

Authentication
+
Role-based authorization
+
Project-level authorization where appropriate

Users should only access resources they are authorized to access.

Financial records require stricter access.

---

# 26. WEB APPLICATION

Use:

React
Vite
TypeScript
Tailwind CSS

Prefer a clean, responsive, mobile-friendly UI.

Main navigation:

Dashboard
Projects
Clients
Labour
Attendance
Measurements
Bills
Payments
Expenses
Reports
AI Assistant
Documents
Settings

---

# 27. MOBILE APPLICATION

Use:

React Native
Expo
TypeScript

Mobile priorities:

Supervisor:

Attendance
Labour
Measurement
Payment records

Owner:

Dashboard
Projects
Financials
AI Assistant
Reports

Mobile must support:

* Offline attendance
* Camera
* Image upload
* Voice input
* Hindi
* English
* Notifications

---

# 28. UI DESIGN PRINCIPLES

The primary user is not a software engineer.

Do not build an ERP-style complicated interface.

Use:

* Large buttons
* Large readable text
* Clear icons
* Simple forms
* Minimal navigation
* Search
* Voice assistant
* Hindi/English toggle
* Confirmation dialogs for financial actions

Important actions should be obvious.

Example:

🏗️ Projects
👷 Labour
📅 Attendance
📋 Bills
💰 Payments
📊 Reports
🎤 Ask AI

---

# 29. LANGUAGE SUPPORT

Implement proper internationalization from day one.

Languages:

English
Hindi

Do not hardcode UI strings.

Use translation keys.

Example:

dashboard
projects
labour
attendance
payments
bills
reports
assistant

Provide:

English:
Dashboard

Hindi:
डैशबोर्ड

Allow user preference to persist.

---

# 30. AI ASSISTANT

Create an AI assistant focused on business operations.

The AI should answer questions such as:

"How much money have we received from Stonede?"

"Tata Project ka outstanding kitna hai?"

"Aaj kitne labour present hain?"

"Ramesh ko kitna payment dena hai?"

"August mein kitna work complete hua?"

"Which projects have outstanding payments?"

"Show labour payment history."

AI must retrieve real data from application tools.

DO NOT allow the model to invent financial figures.

---

# 31. AI TOOL ARCHITECTURE

Create controlled application tools.

Examples:

getProjects()
getProjectDetails(projectId)
getProjectFinancialSummary(projectId)
getClientOutstanding(clientId)
getClientPaymentHistory(clientId)
getTodayAttendance(projectId)
getLabourPayable(projectId)
getLabourPaymentHistory(labourId)
getMonthlyMeasurements(projectId, month)
getBillDetails(billId)
getProjectExpenses(projectId)
getCashFlow(projectId)

The AI should call tools.

The AI must not directly construct database queries.

The AI must not receive unrestricted database access.

---

# 32. AI WRITE OPERATIONS

Read operations can be performed after appropriate authorization.

Write operations require explicit confirmation.

Example:

User:
"Ramesh ko ₹8,000 payment kar do."

AI:

"Ramesh ke liye ₹8,000 ka payment record ready hai. Kya aap confirm karna chahte hain?"

Buttons:

Confirm
Cancel

Only after confirmation should the application write the transaction.

This rule is mandatory.

---

# 33. VOICE AI

Primary experience:

Large microphone button.

Flow:

User speaks
→ Speech-to-text
→ Language detection
→ AI intent
→ Application tool
→ Database
→ AI response
→ Text-to-speech

Support:

Hindi
English
Hinglish

Examples:

"Tata project ka payment kitna aaya?"

"Tata project mein kitna paisa baaki hai?"

"Show today's attendance."

"Ramesh ko kitna dena hai?"

The assistant should understand natural language, not only predefined commands.

---

# 34. AI DOCUMENT PROCESSING

Future-ready architecture should support:

Quotation image/PDF
→ OCR/AI
→ BOQ draft
→ Human review
→ Save

Bank statement
→ Parse
→ Transaction candidates
→ Match project/client
→ Human approval

Payment screenshot
→ OCR/AI
→ Payment draft
→ Human approval

Never automatically finalize extracted financial information without approval in the initial release.

---

# 35. DOCUMENT MANAGEMENT

Firebase Storage structure:

projects/{projectId}/quotation/
projects/{projectId}/measurements/
projects/{projectId}/bills/
projects/{projectId}/payments/
projects/{projectId}/expenses/
projects/{projectId}/other/

Database stores metadata, not large binary data.

---

# 36. BILL PDF

Generate professional bill PDFs.

Bill should contain:

Business name
Project
Client
Bill number
Billing period
Work details
Quantity
Unit
Rate
Amount
Subtotal
Tax/deduction if configured
Final amount

Store generated PDF in Firebase Storage.

---

# 37. REPORTS

Implement:

Project financial report
Client report
Labour report
Attendance report
Monthly billing report
Payment report
Expense report
Outstanding report
Cash flow report

Allow export to:

CSV
Excel where practical
PDF where practical

---

# 38. DASHBOARD

Dashboard should show:

Total projects
Active projects
Total contract value
Total billed
Total received
Total outstanding
Labour cost
Labour payable
Recent payments
Today's attendance
Bills pending
Payments pending

Project cards:

Tata Project Limited - Agra

Contract:
₹18,50,000

Billed:
₹10,00,000

Received:
₹10,00,000

Outstanding:
₹8,50,000

Labour:
₹4,20,000

---

# 39. SEARCH

Global search should support:

Project name
Client name
Labour name
Bill number
Payment reference
Transaction ID

Example:

Search:

"Rakesh"

Results:

Stonede
Rakesh Rao
Tata Project Limited - Agra

---

# 40. NOTIFICATIONS

Use Firebase Cloud Messaging where useful.

Notifications:

Bill pending approval
Payment received
Labour payment due
Monthly billing reminder
Outstanding payment reminder
Attendance incomplete

Notifications should be configurable.

---

# 41. BACKUP

Because this is financial/business data, create a manual export mechanism.

Settings:

Backup / Export Data

Export:

Projects
Clients
Labour
Attendance
Measurements
Bills
Payments
Expenses

Support CSV/JSON exports where practical.

Do not claim automated disaster recovery unless actually implemented.

---

# 42. TESTING

Testing is mandatory.

Create:

Unit tests
Integration tests
Firestore rules tests
Business logic tests
UI tests where practical

Critical business tests:

1. Quantity × Rate calculation
2. Previous quantity + current quantity validation
3. Contract quantity cannot be exceeded
4. Billed vs received calculation
5. Client outstanding calculation
6. Attendance calculation
7. Half-day wage calculation
8. Labour earned vs paid vs payable
9. Duplicate attendance prevention
10. Duplicate payment prevention/idempotency
11. Permission checks
12. Financial audit logs

---

# 43. DEVELOPMENT PROCESS

Do NOT implement the entire application in one giant step.

Work in phases.

After every phase:

1. Build
2. Run tests
3. Fix errors
4. Review architecture
5. Update documentation
6. Commit changes
7. Continue

Do not move to the next major phase if the current phase is broken.

---

# 44. DEVELOPMENT PHASES

## PHASE 0 — DISCOVERY AND ARCHITECTURE

Before coding:

Create:

docs/PRODUCT_REQUIREMENTS.md
docs/ARCHITECTURE.md
docs/DATABASE.md
docs/API_AND_SERVICES.md
docs/SECURITY.md
docs/AI_ARCHITECTURE.md
docs/DEPLOYMENT.md
docs/TESTING.md

Create ER/data model documentation.

Do not code application features until architecture is documented.

---

## PHASE 1 — REPOSITORY FOUNDATION

Create monorepo:

apps/web
apps/mobile
packages/shared
packages/types
packages/validation
docs
firebase

Set up:

TypeScript
ESLint
Prettier
Git
Environment variables
Firebase configuration
Testing

Make sure:

Web starts
Mobile starts
Firebase connects
Firestore connects
Authentication works

---

## PHASE 2 — AUTHENTICATION AND RBAC

Implement:

Login
Logout
User profile
Roles
Permissions
Protected routes
Firebase security rules

Test all roles.

---

## PHASE 3 — CLIENTS AND PROJECTS

Implement:

Clients
Projects
Project dashboard
Project status
Contract value
Project members

Seed:

Tata Project Limited - Agra
Stonede
Rakesh Rao
₹18,50,000

---

## PHASE 4 — BOQ AND RATE CARD

Implement:

BOQ
Work items
Units
Rates
Contract quantities
Automatic amount calculation

Test contract calculations.

---

## PHASE 5 — MEASUREMENTS

Implement:

Measurement Book
Monthly measurements
Location
Quantity
Rate
Amount
Approval workflow
Previous quantity
Remaining quantity

Prevent duplicate/overbilling.

---

## PHASE 6 — BILLING

Implement:

Monthly bill generation
Bill numbering
Bill status
Bill PDF
Bill storage
Billing summary

---

## PHASE 7 — LABOUR

Implement:

Labour profiles
Project assignment
Daily wage
Attendance
Offline attendance
Attendance sync

---

## PHASE 8 — WAGE AND LABOUR PAYMENTS

Implement:

Wage calculation
Payment due
PhonePe reference
Cash payment
Bank transfer
Payment history
Labour outstanding

---

## PHASE 9 — CLIENT PAYMENTS AND FINANCE

Implement:

Manual payments
Bank statement upload
Payment matching
Payment approval
Expenses
Financial ledger
Receivables
Cash flow

---

## PHASE 10 — REPORTS

Implement:

Project report
Labour report
Payment report
Billing report
Expense report
Outstanding report
Monthly report

---

## PHASE 11 — LANGUAGE

Implement:

English
Hindi
Hinglish-friendly AI understanding

Test all major screens.

---

## PHASE 12 — AI TEXT ASSISTANT

Implement:

AI assistant
Tool calling
Project queries
Payment queries
Attendance queries
Labour queries
Financial queries

Implement authorization.

---

## PHASE 13 — VOICE ASSISTANT

Implement:

Microphone
Speech-to-text
Hindi voice
English voice
AI response
Text-to-speech

Optimize for mobile.

---

## PHASE 14 — AI DOCUMENT PROCESSING

Implement:

Payment screenshot extraction
Bank statement parsing
Quotation/BOQ extraction

All extracted financial information must require confirmation.

---

## PHASE 15 — PRODUCTION HARDENING

Perform:

Security review
Firestore rules review
Performance review
Offline sync review
AI safety review
Financial consistency review
Accessibility review
Mobile testing
Browser testing

---

# 45. FIREBASE DEPLOYMENT

Initial deployment MUST target Firebase's no-cost Spark-compatible services.

Web:

Build React/Vite application.

Deploy to Firebase Hosting.

Expected process:

npm run build

firebase deploy --only hosting

Database:

Firebase Firestore

Authentication:

Firebase Authentication

Storage:

Firebase Storage

Do not enable billing automatically.

Do not deploy Cloud Run/Cloud Functions/Cloud SQL unless explicitly approved.

---

# 46. FIREBASE ENVIRONMENTS

Create:

construction-dev
construction-staging
construction-prod

If creating all three Firebase projects immediately creates unnecessary complexity, start with:

construction-dev

Then introduce staging and production before real business usage.

Never mix production data with development data.

---

# 47. ENVIRONMENT VARIABLES

Never commit secrets.

Use:

.env.local

and appropriate Firebase environment configuration.

Never expose private API keys that must remain server-side.

If a required AI integration requires server-side secrets that cannot safely operate from the client without a backend, STOP and document the requirement instead of leaking the secret.

---

# 48. GITHUB CI/CD

Create GitHub Actions.

Pull Request:

Install
Lint
Type check
Unit tests
Build

Main branch:

Build
Run tests
Deploy to Firebase Hosting

Production deployment should require an intentional production action/approval.

---

# 49. GIT WORKFLOW

Use:

main
develop
feature/*

Commit examples:

feat: add project management
feat: add attendance
feat: add measurement billing
fix: prevent duplicate attendance
feat: add Hindi translations

Keep commits small and understandable.

---

# 50. CODE QUALITY

Follow:

SOLID principles where appropriate
DRY
Strong TypeScript types
Clear naming
Small functions
Reusable components
Centralized validation
Centralized business calculations

Do not put business logic directly inside UI components.

For example:

Bad:

React component calculates labour wages.

Good:

packages/shared/src/business/wageCalculator.ts

---

# 51. BUSINESS LOGIC MUST BE DETERMINISTIC

The following must NEVER depend on AI:

Billing calculation
Wage calculation
Outstanding calculation
Payment totals
Attendance totals
Project totals
Financial summaries

AI can interpret questions and explain results.

The source of truth is the database + deterministic business logic.

---

# 52. AI SAFETY

Never allow AI to:

* Invent financial numbers
* Invent payments
* Modify financial records without confirmation
* Delete financial records
* Bypass authorization
* Access unrelated projects
* Execute arbitrary database queries

If data is unavailable:

Say that the information is not available.

Do not guess.

---

# 53. PERFORMANCE

Design Firestore usage carefully.

Avoid:

Loading all projects every time
Loading all attendance every time
Repeated reads
Unnecessary listeners
Unbounded queries

Use:

Pagination
Indexes
Summary documents
Filtered queries
Caching
Offline persistence where appropriate

---

# 54. COST CONTROL

This project is intended to operate at ₹0 initially.

Monitor:

Firestore reads
Firestore writes
Storage
Hosting bandwidth
AI usage

Create a visible/admin usage page if practical.

Never silently introduce a paid service.

If a requirement cannot be implemented within the free Firebase architecture, document:

WHY
WHAT SERVICE IS REQUIRED
ESTIMATED COST
ALTERNATIVE

and wait for approval.

---

# 55. SAMPLE USER JOURNEY

Owner logs in.

Dashboard:

Tata Project Limited - Agra

Contract:
₹18,50,000

Billed:
₹10,00,000

Received:
₹10,00,000

Outstanding:
₹8,50,000

Labour:
₹4,20,000

Owner taps microphone.

Says:

"Tata project mein kitna payment baaki hai?"

AI responds:

"Tata Project Limited mein ₹8,50,000 payment outstanding hai."

Owner asks:

"August mein kitna kaam hua?"

AI queries approved measurements.

AI responds with actual amount.

Owner asks:

"Ramesh ko kitna dena hai?"

AI queries wage/payment data.

AI responds with actual payable amount.

This is the target user experience.

---

# 56. IMPORTANT PRODUCT PRINCIPLE

The platform should be designed around this hierarchy:

1. Data correctness
2. Financial consistency
3. Simplicity
4. Offline reliability
5. Security
6. AI convenience
7. Visual polish

Do NOT sacrifice financial correctness for AI features.

Do NOT sacrifice offline attendance for fancy UI.

Do NOT sacrifice security for development speed.

---

# 57. FIRST TASK

Do NOT start by writing all application code.

Your FIRST response/action should be:

1. Analyze this entire specification.
2. Identify ambiguities and technical risks.
3. Produce the proposed architecture.
4. Produce the Firestore data model.
5. Produce the entity relationship diagram in Mermaid.
6. Produce the project folder structure.
7. Produce the development phases.
8. Produce the Firebase service configuration.
9. Produce the security model.
10. Produce the AI tool architecture.
11. Produce the testing strategy.
12. Produce the deployment strategy.

Then STOP and wait for approval before implementing Phase 1.

Do not skip architecture.

---

# 58. WHEN IMPLEMENTATION STARTS

After approval:

Implement ONE phase at a time.

For every phase:

1. Explain what you are implementing.
2. Create/update files.
3. Run tests.
4. Run lint.
5. Run type checking.
6. Run build.
7. Fix all errors.
8. Show changed files.
9. Explain how to test manually.
10. Update documentation.
11. Give the Git commit message.
12. Wait for approval before starting the next major phase.

---

# 59. DEFINITION OF DONE

A feature is NOT complete merely because code exists.

A feature is complete when:

* UI works
* Mobile behavior works where applicable
* Database model works
* Validation exists
* Authorization exists
* Error handling exists
* Loading states exist
* Empty states exist
* Tests exist
* Build succeeds
* Documentation exists
* No obvious security vulnerability exists

---

# 60. FINAL INSTRUCTION

Treat this as a real production product for a real family construction business.

Do not build a generic demo.

Build the system around the actual business flow:

Tata Project Limited - Agra
→ Stonede / Rakesh Rao
→ ₹18,50,000 contract
→ BOQ/rates
→ area/work measurement
→ monthly billing
→ client payment
→ labour attendance
→ daily wage
→ labour payment
→ project expenses
→ financial summary

The owner should eventually be able to operate most of the platform through simple Hindi/English voice commands.

Keep the first version simple, secure, reliable, offline-capable and Firebase-first.

Most importantly:

**DO NOT introduce paid infrastructure without explicit approval.**

**DO NOT hardcode business numbers.**

**DO NOT use AI for deterministic financial calculations.**

**DO NOT allow AI to perform financial write operations without explicit user confirmation.**

**DO NOT build everything in one step.**

Start with architecture and Phase 0.
