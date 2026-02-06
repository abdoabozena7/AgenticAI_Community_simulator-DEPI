export type IdeaLogStatus = 'running' | 'completed' | 'error' | 'draft';

export interface IdeaLogEntry {
  id: string;
  idea: string;
  createdAt: string;
  status?: IdeaLogStatus;
  simulationId?: string;
  totalAgents?: number;
  acceptanceRate?: number;
  category?: string;
  summary?: string;
}

const STORAGE_KEY = 'ideaLog';
const MAX_ENTRIES = 50;

const safeParse = (raw: string | null): IdeaLogEntry[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === 'object');
  } catch {
    return [];
  }
};

const readLog = (): IdeaLogEntry[] => {
  if (typeof window === 'undefined') return [];
  try {
    return safeParse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
};

const writeLog = (entries: IdeaLogEntry[]) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // ignore
  }
};

const buildEntry = (
  idea: string,
  options?: Partial<IdeaLogEntry>
): IdeaLogEntry => {
  const now = new Date().toISOString();
  const cleanIdea = idea.trim() || 'Untitled idea';
  const simulationId = options?.simulationId;
  const id = simulationId || options?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    idea: cleanIdea,
    createdAt: options?.createdAt || now,
    status: options?.status,
    simulationId,
    totalAgents: options?.totalAgents,
    acceptanceRate: options?.acceptanceRate,
    category: options?.category,
    summary: options?.summary,
  };
};

export const getIdeaLog = (): IdeaLogEntry[] => {
  return readLog();
};

export const addIdeaLogEntry = (
  idea: string,
  options?: {
    simulationId?: string;
    status?: IdeaLogStatus;
    category?: string;
    summary?: string;
    totalAgents?: number;
    acceptanceRate?: number;
  }
): IdeaLogEntry => {
  const entries = readLog();
  const simulationId = options?.simulationId;
  if (simulationId) {
    const idx = entries.findIndex(
      (entry) => entry.simulationId === simulationId || entry.id === simulationId
    );
    if (idx >= 0) {
      const updated = buildEntry(idea, { ...entries[idx], ...options, simulationId });
      updated.createdAt = entries[idx].createdAt || updated.createdAt;
      entries[idx] = updated;
      writeLog(entries);
      return updated;
    }
  }

  const entry = buildEntry(idea, { ...options, simulationId, status: options?.status ?? 'draft' });
  entries.unshift(entry);
  writeLog(entries);
  return entry;
};

export const updateIdeaLogEntry = (
  simulationId: string,
  patch: Partial<IdeaLogEntry>
): IdeaLogEntry | null => {
  if (!simulationId) return null;
  const entries = readLog();
  const idx = entries.findIndex(
    (entry) => entry.simulationId === simulationId || entry.id === simulationId
  );
  if (idx >= 0) {
    const updated = buildEntry(patch.idea || entries[idx].idea, {
      ...entries[idx],
      ...patch,
      simulationId,
    });
    updated.createdAt = entries[idx].createdAt || updated.createdAt;
    entries[idx] = updated;
    writeLog(entries);
    return updated;
  }

  const entry = buildEntry(patch.idea || 'Untitled idea', {
    ...patch,
    simulationId,
    status: patch.status ?? 'draft',
  });
  entries.unshift(entry);
  writeLog(entries);
  return entry;
};
