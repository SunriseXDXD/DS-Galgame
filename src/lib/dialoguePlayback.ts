import type { DialoguePage } from "../types";

export interface DialogueProgress {
  page: DialoguePage | undefined;
  visibleLength: number;
}

export function createDialogueProgress(page: DialoguePage | undefined): DialogueProgress {
  return { page, visibleLength: 0 };
}

/** A newly selected page never inherits the previous page's completed text. */
export function visibleDialogueLength(
  progress: DialogueProgress,
  page: DialoguePage | undefined,
  glyphCount: number,
): number {
  return progress.page === page ? Math.min(progress.visibleLength, glyphCount) : 0;
}

/** Ignore a timer or click that belongs to a page which has already changed. */
export function revealDialogueProgress(
  progress: DialogueProgress,
  page: DialoguePage | undefined,
  glyphCount: number,
  revealAll = false,
): DialogueProgress {
  if (progress.page !== page) return progress;
  const visibleLength = revealAll ? glyphCount : Math.min(progress.visibleLength + 1, glyphCount);
  return visibleLength === progress.visibleLength ? progress : { page, visibleLength };
}

/** Deduplicate concurrent AUTO/manual events and reject callbacks from old pages. */
export function createDialogueAdvanceGate(initialPage: DialoguePage | undefined) {
  let activePage = initialPage;
  let requested = false;
  return {
    select(page: DialoguePage | undefined) {
      activePage = page;
      requested = false;
    },
    request(page: DialoguePage | undefined): boolean {
      if (page !== activePage || requested) return false;
      requested = true;
      return true;
    },
  };
}
