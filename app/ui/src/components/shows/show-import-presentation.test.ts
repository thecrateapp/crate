import { describe, expect, it } from "vitest";
import { reasonText } from "@/lib/ai-models";
import {
  MODEL_METHODS,
  SHOW_FIELD_LABELS,
  SHOW_STATUS_LABELS,
  aiSendNote,
  approvalNextStep,
  countLabel,
  draftRowView,
  isModelMethod,
  issueText,
  mergePlanView,
  mergeShowView,
  methodOptions,
  missingText,
  modelDisplayName,
  ocrReasonText,
  outcomeView,
  pickMethod,
  planChangeView,
  readinessKey,
  readinessState,
  readinessView,
  showErrorText,
  showLinkPath,
  sourceLabel,
  type MethodOption,
} from "./show-import-presentation";
import type {
  ShowAvailability,
  ShowConsolidationPlan,
} from "./show-import-types";

const CONFIGURED_ACTION = {
  configured: true,
  model: "gemini/gemini-3.8-flash",
  provider: "gemini",
  configuration_fingerprint: "fp-1",
  reason: null,
};

function availability(
  overrides: Partial<ShowAvailability> = {},
): ShowAvailability {
  return {
    ocr: { available: true },
    checked_at: "2026-10-20T10:00:00Z",
    actions: {
      vision: { ...CONFIGURED_ACTION },
      text_llm: { ...CONFIGURED_ACTION },
      ocr_text_llm: { ...CONFIGURED_ACTION },
    },
    ...overrides,
  };
}

describe("modelDisplayName", () => {
  it("keeps the last slash segment of a provider-qualified model", () => {
    expect(modelDisplayName("gemini/gemini-3.8-flash")).toBe(
      "gemini-3.8-flash",
    );
  });
  it("leaves an unqualified model unchanged", () => {
    expect(modelDisplayName("gemini-3.8-flash")).toBe("gemini-3.8-flash");
  });
  it("falls back to a generic label when there is no model", () => {
    expect(modelDisplayName(null)).toBe("AI model");
    expect(modelDisplayName("")).toBe("AI model");
  });
});

describe("methodOptions", () => {
  it("returns nothing when there is no source at all", () => {
    expect(
      methodOptions(null, { images: 0, hasText: false }, "loading"),
    ).toEqual([]);
  });

  it("offers the image methods, in order, when every action is configured", () => {
    const options = methodOptions(
      availability(),
      { images: 1, hasText: false },
      "ready",
    );
    expect(options.map((o) => o.method)).toEqual([
      "ocr",
      "ocr_text_llm",
      "vision",
    ]);
    const ocr = options.find((o) => o.method === "ocr")!;
    expect(ocr.cost).toBe("Free · local OCR");
    expect(ocr.billable).toBe(false);
    const vision = options.find((o) => o.method === "vision")!;
    expect(vision.cost).toBe("AI · gemini-3.8-flash");
    expect(vision.model).toBe("gemini/gemini-3.8-flash");
    expect(vision.billable).toBe(true);
  });

  it("disables an AI method that is off, naming the reason and pointing at AI models", () => {
    const options = methodOptions(
      availability({
        actions: {
          vision: { configured: false, reason: "AI_ACTION_DISABLED" },
        },
      }),
      { images: 1, hasText: false },
      "ready",
    );
    const vision = options.find((o) => o.method === "vision")!;
    expect(vision.disabledReason).toBe(reasonText("AI_ACTION_DISABLED"));
    expect(vision.manageInAiModels).toBe(true);
    expect(vision.cost).toBe("AI");
  });

  it("marks an AI method as checking while availability has not loaded", () => {
    const options = methodOptions(
      null,
      { images: 1, hasText: false },
      "loading",
    );
    const vision = options.find((o) => o.method === "vision")!;
    expect(vision.disabledReason).toBe("Checking AI models…");
  });

  it("disables a configured action missing its model or fingerprint", () => {
    const options = methodOptions(
      availability({
        actions: {
          vision: {
            configured: true,
            model: null,
            configuration_fingerprint: null,
          },
        },
      }),
      { images: 1, hasText: false },
      "ready",
    );
    const vision = options.find((o) => o.method === "vision")!;
    expect(vision.disabledReason).toBe("Not available");
    expect(vision.manageInAiModels).toBe(true);
  });

  it("offers only the text methods for pasted text or a link", () => {
    const options = methodOptions(
      availability(),
      { images: 0, hasText: true },
      "ready",
    );
    expect(options.map((o) => o.method)).toEqual(["parse", "text_llm"]);
    const parse = options.find((o) => o.method === "parse")!;
    expect(parse.cost).toBe("Free · no AI");
    expect(parse.billable).toBe(false);
  });

  it("disables OCR with the worker's reason while readiness is unavailable", () => {
    const options = methodOptions(
      availability({ ocr: { available: false, reason: "OCR_UNAVAILABLE" } }),
      { images: 1, hasText: false },
      "unavailable",
    );
    const ocr = options.find((o) => o.method === "ocr")!;
    expect(ocr.disabledReason).toBe("The worker has no OCR engine installed.");
  });

  it("disables Local OCR + AI too, since it needs the OCR engine", () => {
    const options = methodOptions(
      availability({ ocr: { available: false, reason: "OCR_UNAVAILABLE" } }),
      { images: 1, hasText: false },
      "unavailable",
    );
    const byMethod = new Map(options.map((o) => [o.method, o]));
    for (const method of ["ocr", "ocr_text_llm"] as const) {
      expect(byMethod.get(method)!.disabledReason).toBe(
        "The worker has no OCR engine installed.",
      );
      expect(byMethod.get(method)!.manageInAiModels).toBe(false);
    }
    expect(byMethod.get("vision")!.disabledReason).toBeNull();
  });

  it("keeps the AI model reasons ahead of the OCR reason for Local OCR + AI", () => {
    const options = methodOptions(
      availability({
        ocr: { available: false, reason: "OCR_UNAVAILABLE" },
        actions: {
          ocr_text_llm: {
            configured: false,
            reason: "AI_ACTION_DISABLED",
          },
        },
      }),
      { images: 1, hasText: false },
      "unavailable",
    );
    const option = options.find((o) => o.method === "ocr_text_llm")!;
    expect(option.disabledReason).toBe(reasonText("AI_ACTION_DISABLED"));
    expect(option.manageInAiModels).toBe(true);
  });

  it("describes each method card exactly", () => {
    const options = methodOptions(
      availability(),
      { images: 1, hasText: true },
      "ready",
    );
    const byMethod = new Map(options.map((o) => [o.method, o]));
    expect(byMethod.get("ocr")).toMatchObject({
      title: "Local OCR",
      description: "Reads the image on your server. Nothing leaves Crate.",
    });
    expect(byMethod.get("ocr_text_llm")).toMatchObject({
      title: "Local OCR + AI",
      description:
        "Reads the image locally, then sends only the text, never the image.",
    });
    expect(byMethod.get("vision")).toMatchObject({
      title: "AI image reading",
      description: "Sends the poster or screenshot to the AI model.",
    });
  });

  it("describes the text methods exactly", () => {
    const options = methodOptions(
      availability(),
      { images: 0, hasText: true },
      "ready",
    );
    const byMethod = new Map(options.map((o) => [o.method, o]));
    expect(byMethod.get("parse")).toMatchObject({
      title: "Text rules",
      description: "Finds full dates in the text or the linked page. No AI.",
    });
    expect(byMethod.get("text_llm")).toMatchObject({
      title: "AI text reading",
      description: "Sends the pasted text or the text of the linked page.",
    });
  });
});

describe("pickMethod", () => {
  const imageOptions = methodOptions(
    availability(),
    { images: 1, hasText: false },
    "ready",
  );
  const textOptions = methodOptions(
    availability(),
    { images: 0, hasText: true },
    "ready",
  );
  const imageOptionsOcrDisabled = methodOptions(
    availability({ ocr: { available: false, reason: "OCR_UNAVAILABLE" } }),
    { images: 1, hasText: false },
    "unavailable",
  );

  it("falls back to parse when the current AI method is not offered for text", () => {
    expect(pickMethod("vision", textOptions)).toBe("parse");
  });
  it("defaults to ocr for image sources with no current method", () => {
    expect(pickMethod(null, imageOptions)).toBe("ocr");
  });
  it("never falls back to an AI method, even when one is enabled", () => {
    expect(pickMethod("ocr", imageOptionsOcrDisabled)).toBeNull();
  });
  it("drops Local OCR + AI once the OCR engine is unavailable", () => {
    expect(pickMethod("ocr_text_llm", imageOptions)).toBe("ocr_text_llm");
    expect(pickMethod("ocr_text_llm", imageOptionsOcrDisabled)).toBeNull();
    expect(pickMethod(null, imageOptionsOcrDisabled)).toBeNull();
  });
  it("keeps the current AI method when it is enabled", () => {
    expect(pickMethod("vision", imageOptions)).toBe("vision");
  });
});

describe("aiSendNote", () => {
  const base: MethodOption = {
    method: "vision",
    title: "AI image reading",
    description: "",
    cost: "",
    billable: true,
    model: "gemini/gemini-3.8-flash",
    disabledReason: null,
    manageInAiModels: false,
  };
  it("names the model for vision", () => {
    expect(aiSendNote(base)).toBe(
      "Sends the image to gemini-3.8-flash once. This counts toward your AI usage.",
    );
  });
  it("names the model for ocr_text_llm", () => {
    expect(aiSendNote({ ...base, method: "ocr_text_llm" })).toBe(
      "Sends the text read from the image to gemini-3.8-flash once. The image stays on your server. This counts toward your AI usage.",
    );
  });
  it("names the model for text_llm", () => {
    expect(aiSendNote({ ...base, method: "text_llm" })).toBe(
      "Sends the text or the linked page's text to gemini-3.8-flash once. This counts toward your AI usage.",
    );
  });
  it("is null for free methods", () => {
    expect(aiSendNote({ ...base, method: "ocr" })).toBeNull();
    expect(aiSendNote({ ...base, method: "parse" })).toBeNull();
  });
  it.each([
    [
      "vision",
      { pastedText: true, link: false },
      "Sends the image and your pasted text to gemini-3.8-flash once. This counts toward your AI usage.",
    ],
    [
      "vision",
      { pastedText: false, link: true },
      "Sends the image and the linked page's text to gemini-3.8-flash once. This counts toward your AI usage.",
    ],
    [
      "vision",
      { pastedText: true, link: true },
      "Sends the image, your pasted text and the linked page's text to gemini-3.8-flash once. This counts toward your AI usage.",
    ],
    [
      "ocr_text_llm",
      { pastedText: true, link: false },
      "Sends the text read from the image and your pasted text to gemini-3.8-flash once. The image stays on your server. This counts toward your AI usage.",
    ],
    [
      "ocr_text_llm",
      { pastedText: false, link: true },
      "Sends the text read from the image and the linked page's text to gemini-3.8-flash once. The image stays on your server. This counts toward your AI usage.",
    ],
    [
      "ocr_text_llm",
      { pastedText: true, link: true },
      "Sends the text read from the image, your pasted text and the linked page's text to gemini-3.8-flash once. The image stays on your server. This counts toward your AI usage.",
    ],
    [
      "vision",
      { pastedText: false, link: false },
      "Sends the image to gemini-3.8-flash once. This counts toward your AI usage.",
    ],
  ] as const)("tells %s what else it sends: %o", (method, along, text) => {
    expect(aiSendNote({ ...base, method }, along)).toBe(text);
  });
});

describe("isModelMethod", () => {
  it("is true only for the methods that call a model", () => {
    expect(
      (["ocr", "ocr_text_llm", "vision", "parse", "text_llm"] as const).filter(
        isModelMethod,
      ),
    ).toEqual(["ocr_text_llm", "vision", "text_llm"]);
    expect([...MODEL_METHODS].sort()).toEqual([
      "ocr_text_llm",
      "text_llm",
      "vision",
    ]);
  });
});

describe("showLinkPath", () => {
  it("opens the show on Upcoming", () => {
    expect(showLinkPath(7)).toBe("/upcoming?show_id=7");
  });
});

describe("readinessKey", () => {
  it("buckets into 15-minute windows", () => {
    const start = Date.parse("2026-10-20T10:00:00Z");
    const almostNext = Date.parse("2026-10-20T10:14:59Z");
    const next = Date.parse("2026-10-20T10:15:00Z");
    expect(readinessKey(start)).toBe(readinessKey(almostNext));
    expect(readinessKey(start)).not.toBe(readinessKey(next));
    expect(readinessKey(start)).toMatch(/^readiness-\d+$/);
  });
});

describe("readinessState", () => {
  it("prioritises failed", () => {
    expect(
      readinessState(availability(), { checking: true, failed: true }),
    ).toBe("failed");
  });
  it("is checking when a check is in flight", () => {
    expect(readinessState(null, { checking: true, failed: false })).toBe(
      "checking",
    );
  });
  it("is loading before availability has arrived", () => {
    expect(readinessState(null, { checking: false, failed: false })).toBe(
      "loading",
    );
  });
  it("is unchecked when there is no checked_at", () => {
    expect(
      readinessState(availability({ checked_at: undefined }), {
        checking: false,
        failed: false,
      }),
    ).toBe("unchecked");
  });
  it("is ready when the worker reports OCR available", () => {
    expect(
      readinessState(availability(), { checking: false, failed: false }),
    ).toBe("ready");
  });
  it("is unavailable otherwise", () => {
    expect(
      readinessState(availability({ ocr: { available: false } }), {
        checking: false,
        failed: false,
      }),
    ).toBe("unavailable");
  });
});

describe("readinessView", () => {
  it("maps every state to its label and tone", () => {
    expect(readinessView("loading")).toEqual({
      label: "Checking the OCR worker…",
      tone: "info",
    });
    expect(readinessView("checking")).toEqual({
      label: "Checking the OCR worker…",
      tone: "info",
    });
    expect(readinessView("ready")).toEqual({
      label: "OCR ready",
      tone: "success",
    });
    expect(readinessView("unavailable")).toEqual({
      label: "OCR unavailable",
      tone: "warning",
    });
    expect(readinessView("unchecked")).toEqual({
      label: "OCR not checked",
      tone: "neutral",
    });
    expect(readinessView("failed")).toEqual({
      label: "Couldn't check the OCR worker",
      tone: "warning",
    });
  });
});

describe("ocrReasonText", () => {
  it("explains a missing OCR engine", () => {
    expect(ocrReasonText("OCR_UNAVAILABLE")).toBe(
      "The worker has no OCR engine installed.",
    );
  });
  it("explains a version or language mismatch", () => {
    expect(ocrReasonText("OCR_LANGUAGES_OR_VERSION_UNAVAILABLE")).toBe(
      "The worker's OCR engine is not version 5 or lacks English and Spanish.",
    );
  });
  it("falls back for any other code", () => {
    expect(ocrReasonText("SOMETHING_ELSE")).toBe(
      "OCR is not available on the worker.",
    );
    expect(ocrReasonText(null)).toBe("OCR is not available on the worker.");
  });
});

describe("sourceLabel", () => {
  it("shows the host of a link source", () => {
    expect(sourceLabel("https://example.test/event/1")).toEqual({
      text: "example.test",
      href: "https://example.test/event/1",
    });
  });
  it("labels pasted text", () => {
    expect(sourceLabel("pasted-text")).toEqual({ text: "Pasted text" });
  });
  it("labels an uploaded image", () => {
    expect(sourceLabel("upload:0f3c")).toEqual({ text: "Uploaded image" });
  });
  it("labels a source set", () => {
    expect(sourceLabel("source-set:abc")).toEqual({ text: "Several sources" });
  });
  it("is null for an empty reference", () => {
    expect(sourceLabel(null)).toBeNull();
    expect(sourceLabel(undefined)).toBeNull();
    expect(sourceLabel("")).toBeNull();
  });
});

describe("draftRowView", () => {
  it("falls back to Import when the mode is missing", () => {
    expect(
      draftRowView({
        id: "1",
        job_id: "j1",
        status: "completed",
        candidate_count: 2,
      }).title,
    ).toBe("Import");
  });
  it("uses the method title when the mode is known", () => {
    expect(
      draftRowView({
        id: "1",
        job_id: "j1",
        status: "completed",
        mode: "parse",
      }).title,
    ).toBe("Text rules");
  });
  it("shows a still-reading detail for in-flight statuses", () => {
    for (const status of ["pending", "running", "queued"]) {
      expect(
        draftRowView({ id: "1", job_id: "j1", status, mode: "parse" }).detail,
      ).toBe("Still reading");
    }
  });
  it("shows a didn't-finish detail for failed or cancelled jobs", () => {
    for (const status of ["failed", "cancelled"]) {
      expect(
        draftRowView({ id: "1", job_id: "j1", status, mode: "parse" }).detail,
      ).toBe("Didn't finish");
    }
  });
  it("shows no shows found for a zero count", () => {
    expect(
      draftRowView({
        id: "1",
        job_id: "j1",
        status: "completed",
        mode: "parse",
        candidate_count: 0,
      }).detail,
    ).toBe("No shows found");
  });
  it("shows a count of shows found", () => {
    expect(
      draftRowView({
        id: "1",
        job_id: "j1",
        status: "completed",
        mode: "parse",
        candidate_count: 3,
      }).detail,
    ).toBe("3 shows found");
  });
});

describe("outcomeView", () => {
  it("maps every outcome status to its label and tone", () => {
    expect(outcomeView({ item_id: "a", status: "created" })).toEqual({
      label: "Saved",
      tone: "success",
    });
    expect(outcomeView({ item_id: "a", status: "already_exists" })).toEqual({
      label: "Already in Crate",
      tone: "success",
    });
    expect(outcomeView({ item_id: "a", status: "linked_source" })).toEqual({
      label: "Linked to a saved show",
      tone: "success",
    });
    expect(outcomeView({ item_id: "a", status: "conflict" })).toEqual({
      label: "Not saved",
      tone: "warning",
    });
    expect(outcomeView({ item_id: "a", status: "invalid" })).toEqual({
      label: "Needs changes",
      tone: "warning",
    });
    expect(outcomeView({ item_id: "a", status: "failed" })).toEqual({
      label: "Not saved",
      tone: "danger",
    });
    expect(outcomeView({ item_id: "a", status: "weird_status" })).toEqual({
      label: "Weird status",
      tone: "neutral",
    });
  });
});

describe("SHOW_FIELD_LABELS and SHOW_STATUS_LABELS", () => {
  it("labels fields in plain English", () => {
    expect(SHOW_FIELD_LABELS.artist_name).toBe("Artist");
    expect(SHOW_FIELD_LABELS.country_code).toBe("Country code");
    expect(SHOW_FIELD_LABELS.lineup).toBe("Lineup");
  });
  it("labels statuses in plain English", () => {
    expect(SHOW_STATUS_LABELS.onsale).toBe("On sale");
    expect(SHOW_STATUS_LABELS.cancelled).toBe("Cancelled");
  });
});

describe("missingText", () => {
  it("joins two fields with and", () => {
    expect(missingText(["artist_name", "venue"])).toBe(
      "Missing artist and venue",
    );
  });
  it("joins three fields with commas and a final and", () => {
    expect(missingText(["artist_name", "venue", "city"])).toBe(
      "Missing artist, venue and city",
    );
  });
});

describe("countLabel", () => {
  it("keeps the noun singular for one", () => {
    expect(countLabel(1, "show")).toBe("1 show");
  });
  it("pluralises for more than one", () => {
    expect(countLabel(3, "show")).toBe("3 shows");
  });
});

describe("issueText", () => {
  it("describes a missing-fields issue", () => {
    expect(issueText({ missing: ["artist_name", "venue"] }, "Show 1")).toBe(
      "Show 1 is missing artist and venue.",
    );
    expect(issueText({ missing: ["artist_name", "venue"] }, null)).toBe(
      "A show is missing artist and venue.",
    );
  });
  it("describes a reason issue, with or without a row label", () => {
    expect(issueText({ reason: "Dates must include a year" }, "Show 2")).toBe(
      "Show 2: Dates must include a year",
    );
    expect(issueText({ reason: "Dates must include a year" }, null)).toBe(
      "Dates must include a year",
    );
  });
  it("falls back for an issue with neither", () => {
    expect(issueText({}, "Show 3")).toBe("Show 3 can't be saved as it is.");
    expect(issueText({}, null)).toBe("This selection can't be saved as it is.");
  });
});

describe("showErrorText", () => {
  it("unwraps an already-readable server sentence", () => {
    const error = Object.assign(
      new Error(
        JSON.stringify({
          detail: "An unambiguous ISO date with year is required",
        }),
      ),
      { status: 422 },
    );
    expect(showErrorText(error, "fallback")).toBe(
      "An unambiguous ISO date with year is required",
    );
  });
  it("maps a known error code regardless of message", () => {
    const error = Object.assign(new Error("ignored"), {
      status: 409,
      code: "CONFIGURATION_CHANGED",
    });
    expect(showErrorText(error, "fallback")).toBe(
      "The AI model changed. Check the method and try again.",
    );
  });
  it("maps every other known code", () => {
    const mapping: Record<string, string> = {
      LLM_UNAVAILABLE:
        "That AI model isn't available right now. Choose another method.",
      PLAN_STALE:
        "A show changed after your review. Review again before saving.",
      TARGET_BUSY:
        "Another change is saving these shows. Try again in a moment.",
    };
    for (const [code, text] of Object.entries(mapping)) {
      const error = Object.assign(new Error("ignored"), { status: 409, code });
      expect(showErrorText(error, "fallback")).toBe(text);
    }
  });
  it("falls back for unreadable detail shapes", () => {
    const error = new Error(JSON.stringify({ detail: [{ msg: "x" }] }));
    expect(showErrorText(error, "fallback")).toBe("fallback");
  });
  it.each([
    [
      "save",
      true,
      "This change needs approval first. Approve it in Agent approvals, then save again.",
    ],
    [
      "merge",
      true,
      "This merge needs approval first. Approve it in Agent approvals, then merge again.",
    ],
    [
      "save",
      false,
      "This change needs approval first. Someone who can approve changes must approve it in Agent approvals. Then come back and save again.",
    ],
    [
      "merge",
      false,
      "This merge needs approval first. Someone who can approve changes must approve it in Agent approvals. Then come back and merge again.",
    ],
  ] as const)(
    "names the %s action for approval, with approval rights: %s",
    (action, canApprove, text) => {
      const error = Object.assign(new Error("ignored"), {
        status: 409,
        code: "APPROVAL_REQUIRED",
      });
      expect(showErrorText(error, "fallback", { action, canApprove })).toBe(
        text,
      );
    },
  );
  it("explains the editor's other running job in plain words", () => {
    const busy = Object.assign(
      new Error(
        JSON.stringify({
          detail: "This integration already has an active maintenance job",
        }),
      ),
      { status: 429, code: "LIMIT_EXCEEDED" },
    );
    expect(showErrorText(busy, "fallback")).toBe(
      "Another import or save of yours is still running. Try again in a moment.",
    );
    const allowance = Object.assign(
      new Error(
        JSON.stringify({
          detail:
            "Extraction is limited to ten jobs per editor in fifteen minutes",
        }),
      ),
      { status: 429, code: "LIMIT_EXCEEDED" },
    );
    expect(showErrorText(allowance, "fallback")).toBe(
      "Extraction is limited to ten jobs per editor in fifteen minutes",
    );
  });
});

describe("approvalNextStep", () => {
  it("sends only an editor who can approve to Agent approvals", () => {
    expect(approvalNextStep("merge", true)).toBe(
      "Approve it in Agent approvals, then merge.",
    );
    expect(approvalNextStep("save", false)).toBe(
      "Someone who can approve changes must approve it in Agent approvals. Then come back and save.",
    );
  });
});

describe("planChangeView", () => {
  it("summarises a new show without leaking technical identifiers into fields", () => {
    const after = {
      item_id: "a",
      artist_name: "Band",
      date: "2027-03-02",
      venue: "Hall",
      city: "Madrid",
      lineup: ["A", "B"],
      source_ref: "upload:0f3c",
      extractor_model: "gemini/gemini-3.8-flash",
      source_manifest: [
        {
          source_ref: "upload:0f3c",
          sha256: "f".repeat(64),
          modality: "image",
          read: true,
        },
      ],
    };
    const view = planChangeView({ item_id: "a", before: {}, after }, "Show 1");
    expect(view.title).toBe("Band · Tue, Mar 2, 2027");
    expect(view.subtitle).toBe("Hall, Madrid · Time unknown");
    expect(view.isUpdate).toBe(false);
    expect(view.fields).toEqual([
      { key: "lineup", label: "Lineup", value: ["A", "B"], status: "new" },
    ]);
    expect(view.readBy).toBe("gemini-3.8-flash");
    expect(view.source).toEqual({ text: "Uploaded image" });
    expect(view.technical).toContainEqual({
      label: "Show 1 · Source 1",
      value: "image · upload:0f3c · " + "f".repeat(64),
    });
    const serialized = JSON.stringify(view.fields);
    expect(serialized).not.toContain("f".repeat(64));
    expect(serialized).not.toContain("[object Object]");
  });

  it("diffs an update, keeping only the changed fields and counting the rest", () => {
    const before = {
      artist_name: "Band",
      date: "2027-03-02",
      venue: "Hall",
      city: "Madrid",
      url: null,
    };
    const after = {
      item_id: "a",
      artist_name: "Band",
      date: "2027-03-02",
      venue: "Hall Annex",
      city: "Madrid",
      url: "https://x.test",
    };
    const view = planChangeView({ item_id: "a", before, after }, "Show 1");
    expect(view.isUpdate).toBe(true);
    expect(view.unchangedUpdate).toBe(false);
    expect(view.fields.map((f) => [f.key, f.status])).toEqual([
      ["venue", "changed"],
      ["url", "added"],
    ]);
    expect(view.unchanged).toBe(2);
  });

  it("leaves out the artist of a show matched by its details", () => {
    const before = {
      artist_name: "External Band",
      date: "2027-03-02",
      venue: "Hall",
      city: "Madrid",
    };
    const after = { ...before, item_id: "a", artist_name: "EXTERNAL BAND" };
    const matched = planChangeView({ item_id: "a", before, after }, "Show 1");
    expect(matched.fields.map((f) => f.key)).toEqual([]);
    expect(matched.unchangedUpdate).toBe(true);

    const chosen = planChangeView(
      { item_id: "a", before, after: { ...after, existing_show_id: 42 } },
      "Show 1",
    );
    expect(chosen.fields.map((f) => [f.key, f.before, f.value])).toEqual([
      ["artist_name", "External Band", "EXTERNAL BAND"],
    ]);
    expect(chosen.unchangedUpdate).toBe(false);
  });

  it("marks an update that changes nothing", () => {
    const before = {
      artist_name: "Band",
      date: "2027-03-02",
      venue: "Hall",
      city: "Madrid",
    };
    const view = planChangeView(
      { item_id: "a", before, after: { ...before, item_id: "a" } },
      "Show 1",
    );
    expect(view.isUpdate).toBe(true);
    expect(view.unchangedUpdate).toBe(true);
    expect(view.fields).toEqual([]);
    const created = planChangeView(
      { item_id: "a", before: {}, after: { ...before, item_id: "a" } },
      "Show 1",
    );
    expect(created.unchangedUpdate).toBe(false);
  });
});

describe("mergePlanView", () => {
  it("builds the keep/merge view from the consolidation change", () => {
    const plan: ShowConsolidationPlan = {
      plan_id: "p1",
      plan_version: "v1",
      kind: "consolidation",
      executable: true,
      changes: [
        {
          item_id: "consolidation",
          before: {
            shows: [
              {
                id: 7,
                revision: 1,
                artist_name: "Band",
                date: "2027-03-02",
                local_time: null,
                venue: "Hall",
                city: "City",
                attendance_count: 1,
                reminder_count: 0,
              },
              {
                id: 8,
                revision: 1,
                artist_name: "Band",
                date: "2027-03-02",
                local_time: null,
                venue: "Hall",
                city: "City",
                attendance_count: 1,
                reminder_count: 0,
              },
            ],
          },
          after: {
            canonical_show_id: 7,
            duplicate_show_ids: [8],
            revisions: { "7": 1, "8": 1 },
          },
        },
      ],
    };
    const view = mergePlanView(plan);
    expect(view.keep).toEqual({
      id: 7,
      title: "Band · Tue, Mar 2, 2027",
      detail: "Hall, City · Time unknown",
      people: "1 going · 0 reminders",
    });
    expect(view.merge).toEqual([
      {
        id: 8,
        title: "Band · Tue, Mar 2, 2027",
        detail: "Hall, City · Time unknown",
        people: "1 going · 0 reminders",
      },
    ]);
  });
});

describe("mergeShowView", () => {
  it("describes one saved show with its time and people", () => {
    expect(
      mergeShowView({
        id: 8,
        revision: 1,
        artist_name: "Band",
        date: "2027-03-02",
        local_time: "21:00",
        venue: "Hall",
        city: "City",
        attendance_count: 3,
        reminder_count: 1,
      }),
    ).toEqual({
      id: 8,
      title: "Band · Tue, Mar 2, 2027",
      detail: expect.stringMatching(/^Hall, City · (?!Time unknown)/),
      people: "3 going · 1 reminder",
    });
  });
});
