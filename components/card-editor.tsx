"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { resizeImage } from "@/lib/client/image-resize";
import type { CardDTO, DeckDTO, SentenceDTO } from "@/lib/data";
import { linkWords } from "@/lib/sentences";
import { parseImport, type Delimiter } from "@/lib/import-parser";
import { parseSentenceImport, type ParsedSentence } from "@/lib/sentences";
import { langDir } from "@/lib/languages";
import { cardInputSchema, deckInputSchema, LIMITS, zodFieldErrors } from "@/lib/validation";
import { AudioButton } from "./audio";
import { CardImage } from "./card-image";
import { ImagePicker } from "./image-picker";
import { useApp, useToast } from "./providers";
import { LanguageSelect, Spinner } from "./ui";

type Row = {
  key: string;
  id?: string;
  term: string;
  definition: string;
  example: string;
  imageUrl: string | null;
  imageAttribution: string | null;
  /** URL currently displayed (uploaded image endpoint, external URL, or local preview). */
  preview: string | null;
  hasUploadedImage: boolean;
  imageSource: string | null;
  noImage: boolean;
  groupLabel: string | null;
  removeUpload?: boolean;
  pendingUpload?: Blob;
};

let rowCounter = 0;
const newKey = () => `r${++rowCounter}-${Date.now().toString(36)}`;
const emptyRow = (): Row => ({
  key: newKey(),
  term: "",
  definition: "",
  example: "",
  imageUrl: null,
  imageAttribution: null,
  preview: null,
  hasUploadedImage: false,
  imageSource: null,
  noImage: false,
  groupLabel: null,
});

function fromCard(c: CardDTO): Row {
  return {
    key: newKey(),
    id: c.id,
    term: c.term,
    definition: c.definition,
    example: c.example,
    imageUrl: c.imageUrl,
    imageAttribution: c.imageAttribution,
    preview: c.displayImageUrl,
    hasUploadedImage: c.hasUploadedImage,
    imageSource: c.imageSource,
    noImage: c.noImage,
    groupLabel: c.groupLabel,
  };
}

const isBlank = (r: Row) => !r.term.trim() && !r.definition.trim() && !r.example.trim() && !r.preview;

const chunk = <T,>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

type SentenceRow = {
  key: string;
  id?: string;
  text: string;
  translation: string;
  reply: string | null;
  replyTranslation: string;
};

const sentenceRow = (s: Partial<SentenceRow> = {}): SentenceRow => ({
  key: newKey(),
  text: "",
  translation: "",
  reply: null,
  replyTranslation: "",
  ...s,
});

export function DeckEditor({ deck, cards, sentences }: { deck?: DeckDTO; cards?: CardDTO[]; sentences?: SentenceDTO[] }) {
  const router = useRouter();
  const toast = useToast();
  const { gemini } = useApp();
  const [meta, setMeta] = useState({
    title: deck?.title ?? "",
    description: deck?.description ?? "",
    termLang: deck?.termLang ?? "es-ES",
    definitionLang: deck?.definitionLang ?? "en-US",
  });
  const [rows, setRows] = useState<Row[]>(() =>
    cards && cards.length ? cards.map(fromCard) : [emptyRow(), emptyRow(), emptyRow()],
  );
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ key: string; query: string } | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [sentenceRows, setSentenceRows] = useState<SentenceRow[]>(() =>
    (sentences ?? []).map((x) =>
      sentenceRow({ id: x.id, text: x.text, translation: x.translation, reply: x.reply, replyTranslation: x.replyTranslation ?? "" }),
    ),
  );
  const updateSentences = (fn: (rows: SentenceRow[]) => SentenceRow[]) => {
    setSentenceRows(fn);
    setDirty(true);
  };
  const [showGenerate, setShowGenerate] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [autoFilling, setAutoFilling] = useState<Set<string>>(new Set());
  const focusKey = useRef<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLInputElement>());

  /* ---------- unsaved-changes guard ---------- */
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a[href]");
      if (!a || a.getAttribute("target") === "_blank" || a.hasAttribute("download")) return;
      if (!window.confirm("You have unsaved changes. Leave without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  useEffect(() => {
    if (focusKey.current) {
      rowRefs.current.get(focusKey.current)?.focus();
      focusKey.current = null;
    }
  });

  const updateRows = useCallback((fn: (rows: Row[]) => Row[]) => {
    setRows(fn);
    setDirty(true);
  }, []);

  const updateRow = (key: string, patch: Partial<Row>) =>
    updateRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = (focus = true) => {
    const row = emptyRow();
    if (focus) focusKey.current = row.key;
    updateRows((rs) => [...rs, row]);
  };

  const removeRow = (key: string) => {
    const index = rows.findIndex((r) => r.key === key);
    const removed = rows[index];
    if (!removed) return;
    updateRows((rs) => rs.filter((r) => r.key !== key));
    toast.show("Card deleted", {
      action: {
        label: "Undo",
        run: () =>
          updateRows((rs) => {
            if (rs.some((r) => r.key === removed.key)) return rs;
            const copy = rs.slice();
            copy.splice(Math.min(index, copy.length), 0, removed);
            return copy;
          }),
      },
    });
  };

  const move = (key: string, delta: number) =>
    updateRows((rs) => {
      const i = rs.findIndex((r) => r.key === key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= rs.length) return rs;
      const copy = rs.slice();
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const moveTo = (fromKey: string, toKey: string) =>
    updateRows((rs) => {
      const from = rs.findIndex((r) => r.key === fromKey);
      const to = rs.findIndex((r) => r.key === toKey);
      if (from < 0 || to < 0 || from === to) return rs;
      const copy = rs.slice();
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    });

  async function autoFill(row: Row) {
    if (!row.term.trim()) {
      toast.show("Type a term first", { kind: "error" });
      return;
    }
    setAutoFilling((s) => new Set(s).add(row.key));
    try {
      const res = await api<{ translation: string | null; example?: string }>("/api/translate", {
        body: { text: row.term.trim(), from: meta.termLang, to: meta.definitionLang },
      });
      if (res.translation) {
        updateRows((rs) =>
          rs.map((r) =>
            r.key === row.key
              ? { ...r, definition: res.translation!, example: r.example || res.example || "" }
              : r,
          ),
        );
      } else toast.show("No suggestion found — please type the definition", { kind: "error" });
    } catch (err) {
      toast.show(err instanceof ApiClientError ? err.message : "Couldn't get a suggestion", { kind: "error" });
    } finally {
      setAutoFilling((s) => {
        const n = new Set(s);
        n.delete(row.key);
        return n;
      });
    }
  }

  async function onUpload(row: Row, file: File | undefined) {
    if (!file) return;
    try {
      const blob = await resizeImage(file);
      updateRow(row.key, {
        pendingUpload: blob,
        preview: URL.createObjectURL(blob),
        imageUrl: null,
        imageAttribution: null,
        imageSource: "upload",
        noImage: false,
        removeUpload: false,
      });
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Couldn't use that image", { kind: "error" });
    }
  }

  function pasteUrl(row: Row) {
    const url = window.prompt("Paste an image URL (https://…)");
    if (!url) return;
    const check = cardInputSchema.shape.imageUrl.safeParse(url.trim());
    if (!check.success) {
      toast.show("Image URL must start with https://", { kind: "error" });
      return;
    }
    updateRow(row.key, {
      imageUrl: url.trim(),
      imageAttribution: null,
      imageSource: "url",
      noImage: false,
      preview: url.trim(),
      pendingUpload: undefined,
      removeUpload: row.hasUploadedImage,
    });
  }

  function removeImage(row: Row) {
    updateRow(row.key, {
      imageUrl: null,
      imageAttribution: null,
      imageSource: "none",
      noImage: true,
      preview: null,
      pendingUpload: undefined,
      removeUpload: row.hasUploadedImage,
    });
  }

  async function save() {
    const deckCheck = deckInputSchema.safeParse(meta);
    const toSave = rows.filter((r) => !isBlank(r));
    const fieldErrors: Record<string, string> = deckCheck.success ? {} : zodFieldErrors(deckCheck.error);
    toSave.forEach((r) => {
      const check = cardInputSchema.safeParse({
        term: r.term,
        definition: r.definition,
        example: r.example,
        imageUrl: r.imageUrl,
      });
      if (!check.success) {
        for (const [k, v] of Object.entries(zodFieldErrors(check.error))) fieldErrors[`${r.key}.${k}`] = v;
      }
    });
    if (toSave.length > LIMITS.cardsPerDeck) fieldErrors._cards = `A deck can have at most ${LIMITS.cardsPerDeck} cards`;
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) {
      toast.show("Please fix the highlighted fields", { kind: "error" });
      const first = Object.keys(fieldErrors)[0];
      document.getElementById(first.includes(".") ? `${first.replace(".", "-")}` : `deck-${first}`)?.focus();
      return;
    }

    setSaving("Saving…");
    try {
      let deckId = deck?.id;
      if (deckId) await api(`/api/decks/${deckId}`, { method: "PATCH", body: deckCheck.data });
      else deckId = (await api<{ deck: DeckDTO }>("/api/decks", { body: deckCheck.data })).deck.id;

      const res = await api<{ cards: CardDTO[] }>(`/api/decks/${deckId}/cards`, {
        method: "PUT",
        body: {
          cards: toSave.map((r) => ({
            id: r.id,
            term: r.term,
            definition: r.definition,
            example: r.example,
            imageUrl: r.imageUrl,
            imageAttribution: r.imageAttribution,
            imageSource: r.pendingUpload ? "upload" : r.imageSource,
            noImage: r.noImage,
            keepUploadedImage: r.removeUpload ? false : undefined,
          })),
        },
      });
      const saved = res.cards; // same order as toSave
      const sentencesToSave = sentenceRows.filter((x) => x.text.trim());
      if (sentencesToSave.length || (sentences?.length ?? 0) > 0) {
        setSaving("Saving sentences…");
        await api(`/api/decks/${deckId}/sentences`, {
          method: "PUT",
          body: {
            sentences: sentencesToSave.map((x) => ({
              id: x.id,
              text: x.text,
              translation: x.translation,
              reply: x.reply?.trim() ? x.reply : null,
              replyTranslation: x.reply?.trim() ? x.replyTranslation : null,
            })),
          },
        });
      }
      const uploads = toSave
        .map((r, i) => ({ row: r, card: saved[i] }))
        .filter((x) => x.row.pendingUpload && x.card);
      for (const { row, card } of uploads) {
        const form = new FormData();
        form.append("file", row.pendingUpload!, "image.webp");
        try {
          await api(`/api/cards/${card.id}/image`, { form });
        } catch (err) {
          toast.show(err instanceof ApiClientError ? err.message : "Image upload failed", { kind: "error" });
        }
      }
      const uploadedIds = new Set(uploads.map((u) => u.card.id));
      const noImageIds = new Set(saved.filter((c) => c.noImage).map((c) => c.id));

      // With the user's Gemini key: decide which words need a picture + group them by topic.
      if (gemini) {
        const todo = saved.filter((c) => !c.groupLabel).map((c) => c.id);
        const batches = chunk(todo, 60);
        let organizeFailed = false;
        for (let b = 0; b < batches.length; b++) {
          setSaving(`Organising with AI… ${Math.min((b + 1) * 60, todo.length)}/${todo.length}`);
          try {
            const res = await api<{ cards: { id: string; noImage: boolean }[] }>(`/api/decks/${deckId}/organize`, {
              body: { cardIds: batches[b] },
            });
            for (const c of res.cards) {
              if (c.noImage) noImageIds.add(c.id);
              else noImageIds.delete(c.id);
            }
          } catch {
            organizeFailed = true;
            break;
          }
        }
        if (organizeFailed) toast.show("AI organising didn't finish — you can retry from the deck page.", { kind: "error" });
      }

      const missing = saved.filter(
        (c) => !c.imageUrl && !c.hasUploadedImage && !uploadedIds.has(c.id) && !noImageIds.has(c.id),
      );
      if (missing.length) {
        let done = 0;
        setSaving(`Finding images… 0/${missing.length}`);
        await runPool(missing, 3, async (c) => {
          try {
            await api(`/api/cards/${c.id}/auto-image`, { method: "POST" });
          } catch {
            // Image lookup failures are never blocking.
          }
          done++;
          setSaving(`Finding images… ${done}/${missing.length}`);
        });
      }
      setDirty(false);
      toast.show("Deck saved", { kind: "success" });
      router.push(`/decks/${deckId}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) setErrors(err.fields);
      toast.show(err instanceof ApiClientError ? err.message : "Save failed", { kind: "error" });
      setSaving(null);
    }
  }

  const dir = langDir(meta.termLang);
  const cardCount = rows.filter((r) => !isBlank(r)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-extrabold">{deck ? "Edit deck" : "Create a new deck"}</h1>
        {deck && (
          <a className="btn-secondary" href={`/api/decks/${deck.id}/export.csv`} download>
            Export CSV
          </a>
        )}
        <button type="button" className="btn-primary" onClick={save} disabled={Boolean(saving)} data-testid="save-deck">
          {saving ? (
            <>
              <Spinner label={saving} /> {saving}
            </>
          ) : (
            "Save"
          )}
        </button>
      </div>

      <section className="panel grid gap-4 p-5 sm:grid-cols-2" aria-label="Deck details">
        <div className="sm:col-span-2">
          <label htmlFor="deck-title" className="label">
            Title
          </label>
          <input
            id="deck-title"
            className="input"
            value={meta.title}
            maxLength={100}
            placeholder="e.g. Spanish — Kitchen"
            onChange={(e) => {
              setMeta({ ...meta, title: e.target.value });
              setDirty(true);
            }}
            aria-invalid={Boolean(errors.title)}
          />
          {errors.title && <p className="field-error">{errors.title}</p>}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="deck-description" className="label">
            Description <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="deck-description"
            className="input min-h-20"
            value={meta.description}
            maxLength={500}
            onChange={(e) => {
              setMeta({ ...meta, description: e.target.value });
              setDirty(true);
            }}
          />
          {errors.description && <p className="field-error">{errors.description}</p>}
        </div>
        <LanguageSelect
          id="deck-termLang"
          label="Term language (what you're learning)"
          value={meta.termLang}
          onChange={(termLang) => {
            setMeta({ ...meta, termLang });
            setDirty(true);
          }}
        />
        <LanguageSelect
          id="deck-definitionLang"
          label="Definition language (your language)"
          value={meta.definitionLang}
          onChange={(definitionLang) => {
            setMeta({ ...meta, definitionLang });
            setDirty(true);
          }}
        />
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => setShowImport((v) => !v)} aria-expanded={showImport}>
          📋 Bulk import
        </button>
        {gemini ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowGenerate((v) => !v)}
            aria-expanded={showGenerate}
            data-testid="generate-toggle"
          >
            ✨ Generate deck
          </button>
        ) : (
          <Link href="/settings" className="btn-ghost text-sm text-muted" data-testid="generate-hint">
            ✨ Want AI-generated decks? Add your free Gemini key in Settings
          </Link>
        )}
      </div>

      {showImport && (
        <BulkImport
          onAddSentences={(parsed) => {
            updateSentences((rs) => [
              ...rs.filter((x) => x.text.trim()),
              ...parsed.map((p) =>
                sentenceRow({ text: p.text, translation: p.translation, reply: p.reply, replyTranslation: p.replyTranslation ?? "" }),
              ),
            ]);
            setShowImport(false);
            toast.show(`Added ${parsed.length} sentences`, { kind: "success" });
          }}
          onAdd={(parsed) => {
            updateRows((rs) => [
              ...rs.filter((r) => !isBlank(r)),
              ...parsed.map((p) => ({ ...emptyRow(), term: p.term, definition: p.definition })),
            ]);
            setShowImport(false);
            toast.show(`Added ${parsed.length} cards`, { kind: "success" });
          }}
        />
      )}
      {showGenerate && gemini && (
        <GeneratePanel
          termLang={meta.termLang}
          definitionLang={meta.definitionLang}
          onAdd={(generated) => {
            updateRows((rs) => [
              ...rs.filter((r) => !isBlank(r)),
              ...generated.map((g) => ({ ...emptyRow(), term: g.term, definition: g.definition, example: g.example })),
            ]);
            setShowGenerate(false);
            toast.show(`Added ${generated.length} generated cards — review them before saving`, { kind: "success" });
          }}
        />
      )}

      <section aria-label="Cards" className="space-y-3">
        <h2 className="text-lg font-bold">
          Cards <span className="text-sm font-semibold text-muted">({cardCount})</span>
        </h2>
        {errors._cards && <p className="field-error">{errors._cards}</p>}
        <ol className="space-y-3">
          {rows.map((row, index) => {
            const isLast = index === rows.length - 1;
            const err = (k: string) => errors[`${row.key}.${k}`];
            return (
              <li
                key={row.key}
                className={`panel p-4 ${dragKey === row.key ? "opacity-50" : ""}`}
                data-testid="card-row"
                onDragOver={(e) => {
                  if (dragKey) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragKey) moveTo(dragKey, row.key);
                  setDragKey(null);
                }}
              >
                <div className="mb-2 flex items-center gap-1">
                  <span
                    draggable
                    onDragStart={(e) => {
                      setDragKey(row.key);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", row.key);
                    }}
                    onDragEnd={() => setDragKey(null)}
                    className="hidden cursor-grab select-none px-2 text-xl text-muted sm:inline"
                    aria-hidden
                    title="Drag to reorder"
                  >
                    ⠿
                  </span>
                  <span className="mr-auto text-sm font-bold text-muted">{index + 1}</span>
                  <button
                    type="button"
                    className="btn-icon text-base"
                    onClick={() => move(row.key, -1)}
                    disabled={index === 0}
                    aria-label={`Move card ${index + 1} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn-icon text-base"
                    onClick={() => move(row.key, 1)}
                    disabled={isLast}
                    aria-label={`Move card ${index + 1} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn-icon text-base"
                    onClick={() => removeRow(row.key)}
                    aria-label={`Delete card ${index + 1}`}
                  >
                    🗑️
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_7rem]">
                  <div>
                    <label htmlFor={`${row.key}-term`} className="label">
                      Term
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        id={`${row.key}-term`}
                        ref={(el) => {
                          if (el) rowRefs.current.set(row.key, el);
                          else rowRefs.current.delete(row.key);
                        }}
                        className="input"
                        dir={dir}
                        lang={meta.termLang}
                        value={row.term}
                        maxLength={200}
                        onChange={(e) => updateRow(row.key, { term: e.target.value })}
                        aria-invalid={Boolean(err("term"))}
                      />
                      <AudioButton text={row.term} lang={meta.termLang} size="sm" label={`Play term ${index + 1}`} />
                    </div>
                    {err("term") && <p className="field-error">{err("term")}</p>}
                  </div>
                  <div>
                    <label htmlFor={`${row.key}-definition`} className="label">
                      Definition
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        id={`${row.key}-definition`}
                        className="input"
                        dir={langDir(meta.definitionLang)}
                        lang={meta.definitionLang}
                        value={row.definition}
                        maxLength={500}
                        onChange={(e) => updateRow(row.key, { definition: e.target.value })}
                        aria-invalid={Boolean(err("definition"))}
                      />
                      <AudioButton
                        text={row.definition}
                        lang={meta.definitionLang}
                        size="sm"
                        label={`Play definition ${index + 1}`}
                      />
                    </div>
                    <button
                      type="button"
                      className="mt-1 text-sm font-semibold text-accent underline-offset-2 hover:underline disabled:opacity-50"
                      onClick={() => autoFill(row)}
                      disabled={autoFilling.has(row.key)}
                    >
                      {autoFilling.has(row.key) ? "Suggesting…" : "✨ Auto-fill definition"}
                    </button>
                    {err("definition") && <p className="field-error">{err("definition")}</p>}
                  </div>
                  <ImageSlot
                    row={row}
                    index={index}
                    onChoose={() => setPicker({ key: row.key, query: row.definition || row.term })}
                    onUpload={(f) => onUpload(row, f)}
                    onPaste={() => pasteUrl(row)}
                    onRemove={() => removeImage(row)}
                  />
                  <div className="sm:col-span-2">
                    <label htmlFor={`${row.key}-example`} className="label">
                      Example <span className="font-normal text-muted">(optional)</span>
                    </label>
                    <input
                      id={`${row.key}-example`}
                      className="input"
                      dir={dir}
                      lang={meta.termLang}
                      value={row.example}
                      maxLength={500}
                      onChange={(e) => updateRow(row.key, { example: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Tab" && !e.shiftKey && isLast) {
                          e.preventDefault();
                          addRow();
                        }
                      }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <button type="button" className="btn-secondary w-full border-dashed" onClick={() => addRow()}>
          ＋ Add card
        </button>
      </section>

      <SentencesEditor
        rows={sentenceRows}
        cards={rows.filter((r) => r.term.trim()).map((r) => ({ id: r.key, term: r.term }))}
        termLang={meta.termLang}
        definitionLang={meta.definitionLang}
        deckId={deck?.id}
        gemini={gemini}
        onChange={updateSentences}
      />

      <div className="flex justify-end gap-3">
        <Link href={deck ? `/decks/${deck.id}` : "/"} className="btn-ghost">
          Cancel
        </Link>
        <button type="button" className="btn-primary" onClick={save} disabled={Boolean(saving)}>
          {saving ?? "Save"}
        </button>
      </div>

      {picker && (
        <ImagePicker
          initialQuery={picker.query}
          onClose={() => setPicker(null)}
          onPick={(img) => {
            const row = rows.find((r) => r.key === picker.key);
            updateRow(picker.key, {
              imageUrl: img.thumbUrl,
              imageAttribution: img.attribution,
              imageSource: "picked",
              noImage: false,
              preview: img.thumbUrl,
              pendingUpload: undefined,
              removeUpload: row?.hasUploadedImage,
            });
          }}
        />
      )}
    </div>
  );
}

function ImageSlot({
  row,
  index,
  onChoose,
  onUpload,
  onPaste,
  onRemove,
}: {
  row: Row;
  index: number;
  onChoose: () => void;
  onUpload: (f: File | undefined) => void;
  onPaste: () => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const openFilePicker = () => fileRef.current?.click();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={wrapRef} className="relative row-span-2">
      <span className="label">Image</span>
      <button
        type="button"
        className="block h-24 w-full overflow-hidden rounded-xl border border-dashed border-line bg-surface-2 text-sm text-muted hover:border-accent"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Image options for card ${index + 1}`}
        data-testid="image-slot"
      >
        {row.preview ? (
          <CardImage src={row.preview} alt={row.definition || row.term} term={row.term || "?"} className="h-full p-1" />
        ) : row.noImage ? (
          <span className="px-1 text-xs">No picture needed · tap to add</span>
        ) : (
          <span className="px-1 text-xs">Auto image on save</span>
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label={`Upload image for card ${index + 1}`}
        data-testid="image-upload-input"
        onChange={(e) => {
          onUpload(e.target.files?.[0]);
          e.target.value = "";
          setOpen(false);
        }}
      />
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-card"
        >
          <MenuItem label="Choose image" onSelect={() => { onChoose(); setOpen(false); }} />
          <MenuItem label="Upload own image" onSelect={openFilePicker} />
          <MenuItem label="Paste image URL" onSelect={() => { onPaste(); setOpen(false); }} />
          {row.preview && <MenuItem label="Remove image" onSelect={() => { onRemove(); setOpen(false); }} />}
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <button type="button" role="menuitem" className="block min-h-11 w-full px-3 text-left text-sm hover:bg-surface-2" onClick={onSelect}>
      {label}
    </button>
  );
}

function BulkImport({
  onAdd,
  onAddSentences,
}: {
  onAdd: (rows: { term: string; definition: string }[]) => void;
  onAddSentences: (rows: ParsedSentence[]) => void;
}) {
  const [kind, setKind] = useState<"words" | "sentences">("words");
  const [text, setText] = useState("");
  const [delimiter, setDelimiter] = useState<Delimiter>("auto");
  const parsed = useMemo(() => parseImport(text, delimiter), [text, delimiter]);
  const tabs = (
    <div className="flex gap-2" role="tablist" aria-label="What to import">
      {(["words", "sentences"] as const).map((k) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={kind === k}
          className={kind === k ? "btn-primary min-h-9 px-3 text-sm" : "btn-secondary min-h-9 px-3 text-sm"}
          onClick={() => setKind(k)}
          data-testid={`import-tab-${k}`}
        >
          {k === "words" ? "Words" : "Sentences"}
        </button>
      ))}
    </div>
  );
  if (kind === "sentences") {
    return (
      <section className="panel space-y-3 p-5" aria-label="Bulk import">
        <h2 className="font-bold">Bulk import</h2>
        {tabs}
        <SentenceImport onAdd={onAddSentences} />
      </section>
    );
  }
  return (
    <section className="panel space-y-3 p-5" aria-label="Bulk import">
      <h2 className="font-bold">Bulk import</h2>
      {tabs}
      <p className="text-sm text-muted">
        One card per line: <code>term</code> then a tab, a comma, or <code> - </code> then the <code>definition</code>.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="import-delim" className="text-sm font-semibold">
          Delimiter
        </label>
        <select
          id="import-delim"
          className="input w-auto"
          value={delimiter}
          onChange={(e) => setDelimiter(e.target.value as Delimiter)}
        >
          <option value="auto">Auto-detect</option>
          <option value="tab">Tab</option>
          <option value="comma">Comma</option>
          <option value="dash">&quot; - &quot;</option>
        </select>
      </div>
      <label htmlFor="import-text" className="sr-only">
        Cards to import
      </label>
      <textarea
        id="import-text"
        className="input min-h-36 font-mono text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"la manzana - apple\nel cuchillo, knife"}
      />
      {(parsed.rows.length > 0 || parsed.errors.length > 0) && (
        <div className="max-h-60 overflow-auto rounded-xl border border-line" data-testid="import-preview">
          <table className="w-full text-sm">
            <caption className="sr-only">Import preview</caption>
            <thead className="bg-surface-2 text-left">
              <tr>
                <th className="px-3 py-1">#</th>
                <th className="px-3 py-1">Term</th>
                <th className="px-3 py-1">Definition</th>
              </tr>
            </thead>
            <tbody>
              {parsed.rows.map((r) => (
                <tr key={r.line} className="border-t border-line">
                  <td className="px-3 py-1 text-muted">{r.line}</td>
                  <td className="px-3 py-1">{r.term}</td>
                  <td className="px-3 py-1">{r.definition}</td>
                </tr>
              ))}
              {parsed.errors.map((e) => (
                <tr key={`e${e.line}`} className="border-t border-line bg-danger-soft text-danger">
                  <td className="px-3 py-1">{e.line}</td>
                  <td className="px-3 py-1" colSpan={2}>
                    {e.reason}: <span className="font-mono">{e.text}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        className="btn-primary"
        disabled={parsed.rows.length === 0}
        onClick={() => onAdd(parsed.rows)}
      >
        Add {parsed.rows.length} cards
      </button>
    </section>
  );
}

function GeneratePanel({
  termLang,
  definitionLang,
  onAdd,
}: {
  termLang: string;
  definitionLang: string;
  onAdd: (cards: { term: string; definition: string; example: string }[]) => void;
}) {
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ cards: { term: string; definition: string; example: string }[] }>("/api/generate-deck", {
        body: { topic, termLang, definitionLang, count },
      });
      onAdd(res.cards);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel space-y-3 p-5" onSubmit={generate} aria-label="Generate deck">
      <h2 className="font-bold">✨ Generate cards with AI</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <div>
          <label htmlFor="gen-topic" className="label">
            Topic
          </label>
          <input
            id="gen-topic"
            className="input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. kitchen items"
            required
            minLength={2}
          />
        </div>
        <div>
          <label htmlFor="gen-count" className="label">
            Cards
          </label>
          <input
            id="gen-count"
            type="number"
            min={1}
            max={30}
            className="input"
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
          />
        </div>
      </div>
      {error && <p className="field-error">{error}</p>}
      <button type="submit" className="btn-primary" disabled={busy || topic.trim().length < 2}>
        {busy ? "Generating…" : "Generate"}
      </button>
    </form>
  );
}

function SentenceImport({ onAdd }: { onAdd: (rows: ParsedSentence[]) => void }) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseSentenceImport(text), [text]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        One sentence per line: <code>sentence | translation</code> (the translation is optional). For a question with its
        reply use <code>question | translation &gt;&gt; reply | translation</code>.
      </p>
      <label htmlFor="sentence-import-text" className="sr-only">
        Sentences to import
      </label>
      <textarea
        id="sentence-import-text"
        className="input min-h-36 font-mono text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Mir geht's sehr gut. | I'm very well.\nWie heißt du? | What's your name? >> Ich heiße Anna. | My name is Anna."}
      />
      {(parsed.rows.length > 0 || parsed.errors.length > 0) && (
        <ul className="max-h-60 space-y-1 overflow-auto rounded-xl border border-line p-3 text-sm" data-testid="sentence-import-preview">
          {parsed.rows.map((r) => (
            <li key={r.line}>
              <b>{r.text}</b>
              {r.translation && <span className="text-muted"> — {r.translation}</span>}
              {r.reply && (
                <span>
                  {" "}
                  → <b>{r.reply}</b>
                  {r.replyTranslation && <span className="text-muted"> — {r.replyTranslation}</span>}
                </span>
              )}
            </li>
          ))}
          {parsed.errors.map((e) => (
            <li key={`e${e.line}`} className="text-danger">
              Line {e.line}: {e.reason}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn-primary" disabled={parsed.rows.length === 0} onClick={() => onAdd(parsed.rows)}>
        Add {parsed.rows.length} sentences
      </button>
    </div>
  );
}

function SentencesEditor({
  rows,
  cards,
  termLang,
  definitionLang,
  deckId,
  gemini,
  onChange,
}: {
  rows: SentenceRow[];
  cards: { id: string; term: string }[];
  termLang: string;
  definitionLang: string;
  deckId?: string;
  gemini: boolean;
  onChange: (fn: (rows: SentenceRow[]) => SentenceRow[]) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const termOf = new Map(cards.map((c) => [c.id, c.term]));
  const update = (key: string, patch: Partial<SentenceRow>) => onChange((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function generate() {
    if (!deckId) return;
    setBusy(true);
    try {
      const res = await api<{ sentences: { text: string; translation: string; reply?: string | null; replyTranslation?: string | null }[] }>(
        `/api/decks/${deckId}/generate-sentences`,
        { body: { count: 8 } },
      );
      onChange((rs) => [
        ...rs.filter((x) => x.text.trim()),
        ...res.sentences.map((g) => sentenceRow({ text: g.text, translation: g.translation, reply: g.reply ?? null, replyTranslation: g.replyTranslation ?? "" })),
      ]);
      toast.show(`Added ${res.sentences.length} sentences — review them before saving`, { kind: "success" });
    } catch (err) {
      toast.show(err instanceof ApiClientError ? err.message : "Couldn't generate sentences", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="sentences-h" className="space-y-3" data-testid="sentences-editor">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="sentences-h" className="mr-auto text-lg font-bold">
          💬 Sentences <span className="text-sm font-semibold text-muted">({rows.filter((r) => r.text.trim()).length}, optional)</span>
        </h2>
        {gemini && (
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={generate}
            disabled={busy || !deckId || cards.length === 0}
            title={!deckId ? "Save the deck first" : undefined}
            data-testid="generate-sentences"
          >
            {busy ? "Generating…" : "✨ Generate sentences"}
          </button>
        )}
      </div>
      <p className="text-sm text-muted">
        Sentences using your words. Each one unlocks once you’ve mastered its words, then you practise it in context. Add a
        reply to turn it into a question-and-answer pair.
      </p>
      <ol className="space-y-3">
        {rows.map((r, i) => {
          const found = Array.from(
            new Set([...linkWords(r.text, cards, termLang), ...(r.reply ? linkWords(r.reply, cards, termLang) : [])].map((l) => termOf.get(l.cardId)!)),
          );
          return (
            <li key={r.key} className="panel space-y-2 p-4" data-testid="sentence-row">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-muted">{i + 1}</span>
                <span className="mr-auto text-xs text-muted" data-testid="sentence-words">
                  {r.text.trim() ? (found.length ? `Words: ${found.join(", ")}` : "No deck words found in this sentence") : ""}
                </span>
                <button
                  type="button"
                  className="btn-icon text-base"
                  aria-label={`Delete sentence ${i + 1}`}
                  onClick={() => onChange((rs) => rs.filter((x) => x.key !== r.key))}
                >
                  🗑️
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${r.key}-text`} className="label">
                    Sentence
                  </label>
                  <input id={`${r.key}-text`} className="input" lang={termLang} dir={langDir(termLang)} value={r.text} maxLength={300} onChange={(e) => update(r.key, { text: e.target.value })} />
                </div>
                <div>
                  <label htmlFor={`${r.key}-translation`} className="label">
                    Translation <span className="font-normal text-muted">(optional)</span>
                  </label>
                  <input id={`${r.key}-translation`} className="input" lang={definitionLang} dir={langDir(definitionLang)} value={r.translation} maxLength={300} onChange={(e) => update(r.key, { translation: e.target.value })} />
                </div>
                {r.reply !== null ? (
                  <>
                    <div>
                      <label htmlFor={`${r.key}-reply`} className="label">
                        Reply
                      </label>
                      <input id={`${r.key}-reply`} className="input" lang={termLang} dir={langDir(termLang)} value={r.reply} maxLength={300} onChange={(e) => update(r.key, { reply: e.target.value })} />
                    </div>
                    <div>
                      <label htmlFor={`${r.key}-reply-translation`} className="label">
                        Reply translation <span className="font-normal text-muted">(optional)</span>
                      </label>
                      <input id={`${r.key}-reply-translation`} className="input" value={r.replyTranslation} maxLength={300} onChange={(e) => update(r.key, { replyTranslation: e.target.value })} />
                    </div>
                  </>
                ) : (
                  <button type="button" className="text-left text-sm font-semibold text-accent hover:underline" onClick={() => update(r.key, { reply: "" })}>
                    ＋ Add a reply (question &amp; answer)
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <button type="button" className="btn-secondary w-full border-dashed" onClick={() => onChange((rs) => [...rs, sentenceRow()])}>
        ＋ Add sentence
      </button>
    </section>
  );
}
