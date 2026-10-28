/**
 * Hospice workflow and organization settings (founder decision 39). Every default is what the app
 * did before the setting existed, so a hospice that changes nothing sees no difference.
 *
 * Operations change the workflow groups; only administrators change the organization groups
 * (access limits and retention). Every change is audit-logged with before and after.
 */
export const REPORT_KEYS = [
  "overview",
  "households",
  "work",
  "exceptions",
  "bereavement",
  "workforce",
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export type TaskTemplate = {
  id: string;
  title: string;
  detail: string;
  audience: "family" | "staff";
  /** Due this many days after it's added; null for no due date. */
  dueInDays: number | null;
};

export type OrgSettings = {
  queue: {
    /** A household waiting this many hours for a reply moves to high priority. Null: never. */
    messageHighAfterHours: number | null;
    /** Routine follow-ups waiting this many days move to normal priority. Null: never. */
    routineNormalAfterDays: number | null;
  };
  /**
   * When rule-derived exceptions appear and how urgent they become (enterprise blueprint,
   * decision 58). These order the work; they aren't clinical triage.
   */
  exceptions: {
    /** A handoff not accepted after this many hours becomes a Stalled handoff. */
    handoffAcceptHours: number;
    /** Released and not opened by the recipient after this many hours: Waiting on partner. */
    recipientUnopenedHours: number;
    /** Consents and outside or helper access ending within this many days: Access ending. */
    accessEndingDays: number;
    /** An update needing acknowledgement, unacknowledged after this many hours. */
    ackOverdueHours: number;
    /** No contact between the care team and a household receiving care for this many days. */
    noTeamContactDays: number;
    /** This many open exceptions on one household raise Coordination risk. */
    coordinationRiskOpenCount: number;
  };
  assignment: {
    /** Whether "Hand over open work" starts ticked when reassigning (decision 4: off). */
    handOverByDefault: boolean;
    /** Warn when assigning a care guide who already has this many households. Null: no warning. */
    caseloadWarnAt: number | null;
  };
  taskCatalog: TaskTemplate[];
  notifications: {
    /** Starting choices for someone who hasn't set their own. Email stays opt-in (decision 23). */
    cadence: "as_it_happens" | "daily_summary" | "essential_only";
    quietStart: string;
    quietEnd: string;
  };
  reports: { defaultReport: ReportKey; defaultDays: 7 | 30 | 90 };
  /** The staff workspace's wording for non-sensitive statuses. Empty: the standard wording. */
  statusLabels: {
    task: Partial<Record<"open" | "done" | "closed", string>>;
    escalation: Partial<Record<"open" | "acknowledged" | "resolved", string>>;
  };
  /** Decision 70: enrollment stops at the cap. Closed and bereaved households don't count. */
  enrollment: { cap: number };
  access: {
    /** Longest a task-only helper's access can last (decision 42). */
    taskHelperMaxDays: number;
    /** Longest a household collaboration can last (decision 42). */
    collaborationMaxDays: number;
  };
  /**
   * How long records should be kept, in months. Null: keep for the pilot. Zeporah never deletes
   * anything automatically; records past these periods are counted for review in System status.
   */
  retention: {
    closedHouseholdsMonths: number | null;
    messagesMonths: number | null;
  };
};

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  queue: { messageHighAfterHours: null, routineNormalAfterDays: null },
  exceptions: {
    handoffAcceptHours: 24,
    recipientUnopenedHours: 48,
    accessEndingDays: 7,
    ackOverdueHours: 24,
    noTeamContactDays: 5,
    coordinationRiskOpenCount: 3,
  },
  assignment: { handOverByDefault: false, caseloadWarnAt: null },
  taskCatalog: [],
  notifications: { cadence: "as_it_happens", quietStart: "21:00", quietEnd: "08:00" },
  reports: { defaultReport: "overview", defaultDays: 30 },
  statusLabels: { task: {}, escalation: {} },
  enrollment: { cap: 25 },
  access: { taskHelperMaxDays: 90, collaborationMaxDays: 365 },
  retention: { closedHouseholdsMonths: null, messagesMonths: null },
};

export type SettingsGroup = keyof OrgSettings;
export const OPERATIONS_GROUPS = [
  "queue",
  "exceptions",
  "assignment",
  "taskCatalog",
  "notifications",
  "reports",
  "statusLabels",
] as const;
export const ADMIN_GROUPS = ["enrollment", "access", "retention"] as const;

export const GROUP_LABELS: Record<SettingsGroup, string> = {
  queue: "Queue thresholds",
  exceptions: "Exception thresholds",
  assignment: "Assignment defaults",
  taskCatalog: "Task catalog",
  notifications: "Notification defaults",
  reports: "Report views",
  statusLabels: "Workflow status wording",
  enrollment: "Enrollment",
  access: "Access limits",
  retention: "Retention rules",
};

/** Stored settings merged over the defaults, group by group. */
export function withDefaults(stored: Partial<OrgSettings> | null | undefined): OrgSettings {
  const s = stored ?? {};
  return {
    queue: { ...DEFAULT_ORG_SETTINGS.queue, ...s.queue },
    exceptions: { ...DEFAULT_ORG_SETTINGS.exceptions, ...s.exceptions },
    assignment: { ...DEFAULT_ORG_SETTINGS.assignment, ...s.assignment },
    taskCatalog: s.taskCatalog ?? DEFAULT_ORG_SETTINGS.taskCatalog,
    notifications: { ...DEFAULT_ORG_SETTINGS.notifications, ...s.notifications },
    reports: { ...DEFAULT_ORG_SETTINGS.reports, ...s.reports },
    statusLabels: {
      task: { ...s.statusLabels?.task },
      escalation: { ...s.statusLabels?.escalation },
    },
    enrollment: { ...DEFAULT_ORG_SETTINGS.enrollment, ...s.enrollment },
    access: { ...DEFAULT_ORG_SETTINGS.access, ...s.access },
    retention: { ...DEFAULT_ORG_SETTINGS.retention, ...s.retention },
  };
}
