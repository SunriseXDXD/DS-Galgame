import { sceneToPages } from "./dialogue";
import { decodeSaveSnapshot } from "./saveSlots";
import type { SaveGameStateV1 } from "./saveSlots";
import type { ModelId } from "../types";

/** Restore only validated story fields; connection settings stay outside this boundary. */
export function restoreStoryState(source: unknown, allowedModels?: readonly ModelId[]): SaveGameStateV1 {
  const decoded = decodeSaveSnapshot(source);
  if (!decoded.ok) throw new Error(decoded.error.message);
  const state = decoded.snapshot.state;
  const pages = sceneToPages(state.scene);
  return {
    scene: state.scene,
    history: state.history,
    pageIndex: Math.min(state.pageIndex, Math.max(0, pages.length - 1)),
    model: allowedModels?.length && !allowedModels.includes(state.model) ? allowedModels[0] : state.model,
  };
}
