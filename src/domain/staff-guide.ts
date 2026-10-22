import type { StaffRole } from "./model";

/**
 * The care-team first-time guide (2026-10-21): which guide each person gets, and the tour's steps.
 * Each step points at something real on screen (a sidebar item, the search box, Help); a step whose
 * target isn't on screen is shown in the middle instead. Practical orientation only: no clinical,
 * legal or security claims.
 */
export type GuideRole = "care_guide" | "hospice_ops" | "privileged_reviewer" | "hospice_admin";

/** Their household-facing role first, then operations, review, administration. */
export function guideRole(roles: readonly string[]): GuideRole {
  for (const r of ["care_guide", "hospice_ops", "privileged_reviewer", "hospice_admin"] as const)
    if (roles.includes(r)) return r;
  return "care_guide";
}

export type TourStep = {
  /** A CSS selector for what to point at; none for the opening step. */
  target?: string;
  title: string;
  body: string;
};

const nav = (path: string) => `nav[aria-label="Main"] a[href="${path}"]`;
const SEARCH = '[data-topbar] [data-tour="search"]';
const HELP = '[data-topbar] button[aria-label="Help"]';

const WELCOME: TourStep = {
  title: "Welcome to Zeporah",
  body: "This is the care team's workspace for coordinating with households: who needs what, who's on it, and what has been shared. Here's where things are. It takes about a minute.",
};
const SEARCH_STEP: TourStep = {
  target: SEARCH,
  title: "Search from anywhere",
  body: "Find a household, person or packet from any page. Press ⌘K (Ctrl K on Windows) to open it.",
};
const HELP_STEP: TourStep = {
  target: HELP,
  title: "Help is always here",
  body: "Help explains each status and how the queue is ordered. You can take this tour again from here.",
};

export const TOURS: Record<GuideRole, TourStep[]> = {
  care_guide: [
    WELCOME,
    {
      target: nav("/staff"),
      title: "My work",
      body: "Everything assigned to you, with anything overdue or due today first, and escalations that still need an owner.",
    },
    {
      target: nav("/staff/exceptions"),
      title: "Exceptions",
      body: "Everything that needs attention across your households, most urgent first, each with why it's here and the next step. Urgency orders the work; it isn't clinical triage.",
    },
    {
      target: nav("/staff/households"),
      title: "Households",
      body: "Each household's page holds its messages, tasks, vault, sharing and history in one place.",
    },
    SEARCH_STEP,
    HELP_STEP,
  ],
  hospice_ops: [
    WELCOME,
    {
      target: nav("/staff/exceptions"),
      title: "Exceptions",
      body: "What needs attention across the hospice, and what has no owner. Take or assign it, and see what's waiting longest.",
    },
    {
      target: nav("/staff/team"),
      title: "Team & coverage",
      body: "Assign care guides to households, see each guide's workload, and invite new staff.",
    },
    {
      target: nav("/staff/settings"),
      title: "Hospice settings",
      body: "What families are told about replies, queue thresholds, common tasks and other day-to-day settings.",
    },
    {
      target: nav("/staff/reports"),
      title: "Reports",
      body: "Workflow counts for the hospice, with each number linking to the list behind it.",
    },
    HELP_STEP,
  ],
  privileged_reviewer: [
    WELCOME,
    {
      target: nav("/staff/reviews"),
      title: "Reviews",
      body: "Authority evidence waiting for a reviewer. You record a workflow decision; it isn't a legal determination.",
    },
    {
      target: nav("/staff/sharing"),
      title: "Sharing register",
      body: "Every consent in one place, with what needs a person first.",
    },
    {
      target: nav("/staff/packets"),
      title: "Packets",
      body: "Packets waiting to be released. Release happens on each packet's own page, after every check passes.",
    },
    SEARCH_STEP,
    HELP_STEP,
  ],
  hospice_admin: [
    WELCOME,
    {
      target: nav("/staff/admin"),
      title: "Administration",
      body: "An overview of the team by role, recent staff changes and invitations waiting.",
    },
    {
      target: nav("/staff/team"),
      title: "Team & coverage",
      body: "Roles, care-guide coverage and invitations. Administrators manage coverage without opening household records.",
    },
    {
      target: nav("/staff/settings"),
      title: "Hospice settings",
      body: "Organization controls such as access limits and record retention are yours to change.",
    },
    HELP_STEP,
  ],
};

/** Starts the tour from anywhere in the workspace (Help, the welcome card, the checklist). */
export const START_TOUR_EVENT = "zeporah:start-tour";
export function startTour() {
  window.dispatchEvent(new Event(START_TOUR_EVENT));
}

export type { StaffRole };
