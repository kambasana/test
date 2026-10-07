// Sample organisation and library for demo mode (the Elenta draft).

export const DEMO_ORG = {
  office: { name: 'Elenta', wing: 'Main', wings: [{ name: 'Main', url: '' }] },
  problems: [],
  departments: [
    {
      key: 'boss', name: 'BOSS', boss: true,
      about: 'Decides which department owns a request and hands it over.',
      lead: { id: 'boss', name: 'BOSS', role: 'Head of the office', does: 'Reads every request and routes it to the department that owns the domain.' },
      teams: [
        { name: 'OFFICE OF THE BOSS', people: [
          { id: 'chief-of-staff', name: 'CHIEF OF STAFF', role: 'Keeps the queue moving', does: 'Tracks open jobs and chases approvals.' },
          { id: 'boss-coordinator', name: 'COORDINATOR', role: 'Cross-department hand-offs', does: 'Joins work that needs two departments.' },
        ] },
      ],
    },
    {
      key: 'military', name: 'MILITARY', color: '#C9A227',
      about: 'All military-domain work: software, documents, analysis, compliance.',
      lead: { id: 'mil-lead', name: 'MILITARY LEAD', role: 'Owns delivery for the military domain', does: 'Splits requests by sub-team and signs off the combined result.' },
      teams: [
        { name: 'SOFTWARE', people: [
          { id: 'mil-software-engineer', name: 'SOFTWARE ENGINEER', role: 'Embedded and tooling code', does: 'Writes and reviews code for logger and radar tools.' },
          { id: 'mil-test-engineer', name: 'TEST ENGINEER', role: 'Verification', does: 'Designs test cases and procedures.' },
          { id: 'mil-systems-architect', name: 'SYSTEMS ARCHITECT', role: 'Interfaces and requirements', does: 'Keeps requirements and interfaces consistent.' },
        ] },
        { name: 'DOCUMENTATION', people: [
          { id: 'mil-technical-writer', name: 'TECHNICAL WRITER', role: 'Manuals and plans', does: 'Writes manuals, plans and memos in house style.' },
          { id: 'mil-configuration-manager', name: 'CONFIGURATION MANAGER', role: 'Document control', does: 'Keeps revisions and baselines straight.' },
        ] },
        { name: 'ANALYSIS', people: [
          { id: 'mil-operations-analyst', name: 'OPERATIONS ANALYST', role: 'Field results', does: 'Reads field-test data and explains it.' },
          { id: 'mil-data-analyst', name: 'DATA ANALYST', role: 'Numbers and trends', does: 'Builds tables and finds anomalies.' },
        ] },
        { name: 'COMPLIANCE', people: [
          { id: 'mil-export-control-officer', name: 'EXPORT CONTROL OFFICER', role: 'Export screening', does: 'Screens material against the export checklist.' },
          { id: 'mil-quality-assurance', name: 'QUALITY ASSURANCE', role: 'Traceability', does: 'Checks that every requirement is covered.' },
        ] },
      ],
    },
    {
      key: 'business', name: 'BUSINESS', color: '#6A9FD8',
      about: 'Running the company: money, contracts and the office itself.',
      lead: { id: 'biz-lead', name: 'BUSINESS LEAD', role: 'Owns delivery for the business side', does: 'Splits requests and combines the answer.' },
      teams: [
        { name: 'FINANCE', people: [
          { id: 'biz-financial-controller', name: 'FINANCIAL CONTROLLER', role: 'Budgets and reporting', does: 'Prepares budgets and cost reports.' },
          { id: 'biz-cost-analyst', name: 'COST ANALYST', role: 'Cost models', does: 'Breaks costs down by line item.' },
        ] },
        { name: 'CONTRACTS', people: [
          { id: 'biz-contracts-manager', name: 'CONTRACTS MANAGER', role: 'Terms and renewals', does: 'Reviews terms and drafts renewals.' },
          { id: 'biz-bid-writer', name: 'BID WRITER', role: 'Tenders', does: 'Writes bids and proposals.' },
        ] },
        { name: 'ADMIN', people: [
          { id: 'biz-office-administrator', name: 'OFFICE ADMINISTRATOR', role: 'Office and people', does: 'Handles onboarding, rooms and schedules.' },
        ] },
      ],
    },
  ],
};

export const DEMO_NOTES = [
  { path: 'shared/house-style.md', title: 'House style', text: '# House style\n\nShort sentences. Active voice. Numbers as digits. Every document starts with its purpose in one line.' },
  { path: 'shared/document-template.md', title: 'Document template', text: '# Document template\n\n1. Purpose\n2. Scope\n3. Body\n4. Open points\n5. Notes used' },
  { path: 'shared/glossary.md', title: 'Glossary', text: '# Glossary\n\n- **DL-7**: the data-logger unit.\n- **RTM**: requirements traceability matrix.' },
  { path: 'military/code-review-checklist.md', title: 'Code review checklist', text: '# Code review checklist\n\n- Inputs validated\n- Errors handled\n- Tests updated' },
  { path: 'military/export-screening-checklist.md', title: 'Export-screening checklist', text: '# Export-screening checklist\n\n- Performance figures?\n- Controlled technology named?\n- Destination listed?' },
  { path: 'military/test-plan-template.md', title: 'Test-plan template', text: '# Test-plan template\n\nScope, items under test, approach, environment, cases, traceability, exit criteria.' },
  { path: 'business/contract-review-checklist.md', title: 'Contract review checklist', text: '# Contract review checklist\n\n- Term and renewal\n- Liability caps\n- Payment terms' },
  { path: 'business/cost-model-notes.md', title: 'Cost model notes', text: '# Cost model notes\n\nLabour at blended day rate; materials at quoted price plus 8% handling.' },
  { path: 'lessons/military.md', title: 'Lessons: MILITARY', text: '# Lessons: MILITARY\n\n- 2026-09-30: Put the traceability table before the appendices.' },
];

// Words the demo Boss and leads match on.
export const TEAM_WORDS = {
  SOFTWARE: ['software', 'code', 'firmware', 'test', 'tests', 'logger', 'tool', 'script', 'bug', 'unit'],
  DOCUMENTATION: ['write', 'manual', 'document', 'chapter', 'plan', 'memo', 'report', 'draft', 'one-page', 'summarise'],
  ANALYSIS: ['analyse', 'analysis', 'results', 'data', 'anomalies', 'trend', 'field', 'assess'],
  COMPLIANCE: ['export', 'compliance', 'screening', 'traceability', 'requirements', 'regulation', 'datasheet'],
  FINANCE: ['cost', 'costs', 'budget', 'invoice', 'finance', 'price', 'breakdown', 'quarter'],
  CONTRACTS: ['contract', 'supplier', 'tender', 'bid', 'renewal', 'renewing', 'terms'],
  ADMIN: ['onboarding', 'office', 'staff', 'admin', 'schedule', 'checklist', 'room'],
  'OFFICE OF THE BOSS': ['status', 'priorities'],
};

export const DEPT_WORDS = {
  military: ['military', 'radar', 'sensor', 'defence', 'defense', 'range', 'mission', 'data-logger'],
  business: ['business', 'money', 'customer', 'staff', 'company'],
};

export const PIECE_TITLES = {
  SOFTWARE: 'Test cases and procedures for the software',
  DOCUMENTATION: 'Structure, front matter and write-up',
  ANALYSIS: 'Data review and findings',
  COMPLIANCE: 'Traceability and export-screening check',
  FINANCE: 'Cost breakdown by line item',
  CONTRACTS: 'Terms, renewal dates and risks',
  ADMIN: 'Checklist and schedule',
  'OFFICE OF THE BOSS': 'Status summary',
};

export const SAMPLE_REQUESTS = [
  'Draft the operator manual chapter for the radar maintenance software',
  'Prepare a cost breakdown for renewing the test-range supplier contract',
  'Run an export-screening check on the new sensor datasheet and summarise the findings',
  'Write the onboarding checklist and first-week schedule for two new office staff',
  'Analyse last quarter\'s field-test results for the data logger and flag anomalies',
];
