import dataset from "./shelf-public-context-2026-10-15.json";
import metadata from "./shelf-public-context-metadata.json";

type ContextRecord = {
  id: string | number;
  description?: string;
  firstMessage?: string;
};

type ContextShelf = {
  id: string;
  shelfDescription: string;
  shelfFirstMessage: string;
  contextDeferred?: boolean;
};
const records = dataset.characters as ContextRecord[];
const shelfRecords = metadata.characters as ContextShelf[];
if (
  records.length !== shelfRecords.length ||
  records.some((record, index) => String(record.id) !== shelfRecords[index]?.id)
) {
  throw new Error("公开语境清单与正文不一致。");
}

const collapsed = (value: string | undefined) => String(value ?? "").replace(/\s+/g, " ").trim();

export const SHELF_PUBLIC_CONTEXT_BY_ID = new Map(
  records.map((record) => {
    const description = String(record.description ?? "");
    const firstMessage = String(record.firstMessage ?? "");
    const shelf = shelfRecords.find((item) => item.id === String(record.id));
    const descriptionShelf = collapsed(record.description);
    const firstMessageShelf = collapsed(record.firstMessage);
    const deferred =
      descriptionShelf.length > (shelf?.shelfDescription.length ?? 0) ||
      firstMessageShelf.length > (shelf?.shelfFirstMessage.length ?? 0);
    if (!shelf || shelf.contextDeferred !== deferred) throw new Error("公开语境摘要与正文不一致。");
    return [String(record.id), { description, firstMessage }] as const;
  }),
);

export function shelfPublicContextText(id: string) {
  return SHELF_PUBLIC_CONTEXT_BY_ID.get(id) ?? null;
}
