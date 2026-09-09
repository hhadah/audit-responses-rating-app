const state = {
  authRequired: true,
  passcode: "",
  participantId: "",
  bundle: null,
  items: [],
  order: [],
  index: 0,
  answers: {},
};

const element = (id) => document.getElementById(id);

function authHeaders() {
  return state.passcode ? { "X-Passcode": state.passcode } : {};
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledOrder() {
  const random = mulberry32(hash(`order||${state.participantId}`));
  const order = state.items.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  return order;
}

function leftVersionId(item) {
  const index = hash(`${state.participantId}||${item.id}`) % 2;
  return item.versions[index].id;
}

function currentItem() {
  return state.items[state.order[state.index]];
}

function currentSides(item) {
  const leftId = leftVersionId(item);
  const left = item.versions.find((version) => version.id === leftId);
  const right = item.versions.find((version) => version.id !== leftId);
  return { left, right };
}

function answeredCount() {
  return state.order.filter((index) => state.items[index].id in state.answers).length;
}

function setText(id, value) {
  element(id).textContent = value;
}

function show(id) {
  element(id).classList.remove("hidden");
}

function hide(id) {
  element(id).classList.add("hidden");
}

function renderRatingOptions() {
  const container = element("ratingOptions");
  container.replaceChildren();
  for (const option of state.bundle.study.rating_scale) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "rating";
    input.value = String(option.value);
    label.append(input, document.createTextNode(option.label));
    container.append(label);
  }
}

function updateOtherBox() {
  const otherKey = state.bundle?.study.other_reason_key;
  const checked = otherKey
    ? document.querySelector(`input[name="reason"][value="${CSS.escape(otherKey)}"]`)?.checked
    : false;
  element("otherBox").classList.toggle("hidden", !checked);
}

function renderReasonOptions() {
  const study = state.bundle.study;
  const container = element("reasonOptions");
  container.replaceChildren();
  element("reasonsCard").classList.toggle("hidden", study.reasons.length === 0);
  for (const reason of study.reasons) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "reason";
    input.value = reason.key;
    input.addEventListener("change", updateOtherBox);
    label.append(input, document.createTextNode(reason.label));
    container.append(label);
  }
}

function applyStudy() {
  const study = state.bundle.study;
  document.title = study.title;
  document.documentElement.style.setProperty("--accent", study.accent_color);
  setText("studyTitle", study.title);
  setText("studyDescription", study.description);
  setText("participantPrompt", study.participant_prompt);
  setText("participantHelp", study.participant_help);
  element("participantId").placeholder = study.participant_placeholder;
  setText("comparisonInstructions", study.comparison_instructions);
  setText("leftHeading", study.left_heading);
  setText("rightHeading", study.right_heading);
  setText("ratingQuestion", study.rating_question);
  setText("reasonQuestion", study.reason_question);
  setText("reasonHelp", study.reason_help);
  setText("otherPrompt", study.other_prompt);
  setText("completionTitle", study.completion_title);
  setText("completionMessage", study.completion_message);
  renderRatingOptions();
  renderReasonOptions();
}

async function jsonError(response, fallback) {
  const body = await response.json().catch(() => ({}));
  return body.error || fallback;
}

async function startStudy() {
  setText("startError", "");
  state.participantId = element("participantId").value.trim();
  if (!state.participantId) {
    setText("startError", "Enter your name or rater ID.");
    return;
  }

  if (state.authRequired) {
    state.passcode = element("passcode").value.trim();
    if (!state.passcode) {
      setText("startError", "Enter the study passcode.");
      return;
    }
    const loginResponse = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: state.passcode }),
    }).catch(() => null);
    if (!loginResponse?.ok) {
      setText("startError", "The passcode is incorrect or the app is unavailable.");
      return;
    }
  }

  element("startButton").disabled = true;
  try {
    const [studyResponse, progressResponse] = await Promise.all([
      fetch("/api/study", { headers: authHeaders() }),
      fetch(`/api/progress?rater=${encodeURIComponent(state.participantId)}`, {
        headers: authHeaders(),
      }),
    ]);
    if (!studyResponse.ok) {
      setText("startError", await jsonError(studyResponse, "Could not load the study."));
      return;
    }
    if (!progressResponse.ok) {
      setText("startError", await jsonError(progressResponse, "Could not load saved progress."));
      return;
    }

    state.bundle = await studyResponse.json();
    state.items = state.bundle.items;
    state.answers = (await progressResponse.json()).answers || {};
    state.order = shuffledOrder();
    state.index = state.order.findIndex((index) => !(state.items[index].id in state.answers));

    localStorage.setItem("participantId", state.participantId);
    localStorage.setItem("rater", state.participantId);
    if (state.passcode) {
      localStorage.setItem("participantPasscode", state.passcode);
      localStorage.setItem("passcode", state.passcode);
      document.cookie = `participant_passcode=${encodeURIComponent(state.passcode)}; path=/; max-age=31536000; SameSite=Lax; Secure`;
    }

    applyStudy();
    hide("nameScreen");
    setText("participantPill", state.participantId);
    if (state.index === -1) showDone();
    else showCurrentItem();
  } catch {
    setText("startError", "Could not connect to the study. Check your connection and try again.");
  } finally {
    element("startButton").disabled = false;
  }
}

function showCurrentItem() {
  hide("doneScreen");
  show("ratingScreen");
  const item = currentItem();
  const { left, right } = currentSides(item);
  const study = state.bundle.study;
  const itemTerm = study.item_term.charAt(0).toUpperCase() + study.item_term.slice(1);
  setText("itemTitle", `${itemTerm} ${state.index + 1} of ${state.items.length}`);
  setText("leftContent", left.content);
  setText("rightContent", right.content);

  const answer = state.answers[item.id];
  document.querySelectorAll('input[name="rating"]').forEach((input) => {
    input.checked = Boolean(answer) && String(answer.rating) === input.value;
  });
  document.querySelectorAll('input[name="reason"]').forEach((input) => {
    input.checked = Boolean(answer?.reasons?.includes(input.value));
  });
  element("otherText").value = answer?.other_text || "";
  updateOtherBox();

  element("previousButton").disabled = state.index === 0;
  setText(
    "nextButton",
    state.index === state.items.length - 1 ? "Save & Finish" : "Save & Next",
  );
  setText("ratingError", "");
  const count = answeredCount();
  setText("progressText", `${count} / ${state.items.length} answered`);
  element("progressFill").style.width = `${(100 * count) / state.items.length}%`;
  window.scrollTo(0, 0);
}

async function saveCurrentItem() {
  setText("ratingError", "");
  const item = currentItem();
  const selectedRating = document.querySelector('input[name="rating"]:checked');
  if (!selectedRating) {
    setText("ratingError", "Select a rating before saving.");
    return false;
  }

  const rating = Number(selectedRating.value);
  const reasons = [...document.querySelectorAll('input[name="reason"]:checked')].map(
    (input) => input.value,
  );
  if (state.bundle.study.require_reason_when_non_neutral && rating !== 0 && reasons.length === 0) {
    setText("ratingError", "Select at least one reason for a non-neutral rating.");
    return false;
  }

  const { left, right } = currentSides(item);
  const payload = {
    participant_id: state.participantId,
    rater: state.participantId,
    item_id: item.id,
    pair_id: item.id,
    left_version: left.id,
    right_version: right.id,
    left_round: left.id,
    right_round: right.id,
    rating,
    reasons,
    other_text:
      state.bundle.study.other_reason_key && reasons.includes(state.bundle.study.other_reason_key)
        ? element("otherText").value
        : "",
  };

  element("nextButton").disabled = true;
  try {
    const response = await fetch("/api/response", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      setText("ratingError", await jsonError(response, "The response could not be saved."));
      return false;
    }
    state.answers[item.id] = {
      rating: payload.rating,
      reasons: payload.reasons,
      other_text: payload.other_text,
      left_version: payload.left_version,
      right_version: payload.right_version,
    };
    element("savedMessage").style.visibility = "visible";
    setTimeout(() => {
      element("savedMessage").style.visibility = "hidden";
    }, 1200);
    return true;
  } catch {
    setText("ratingError", "The response could not be saved. Check your connection and try again.");
    return false;
  } finally {
    element("nextButton").disabled = false;
  }
}

function advance() {
  const nextUnanswered = state.order.findIndex(
    (itemIndex, orderIndex) =>
      orderIndex > state.index && !(state.items[itemIndex].id in state.answers),
  );
  if (nextUnanswered !== -1) {
    state.index = nextUnanswered;
    showCurrentItem();
  } else if (answeredCount() === state.items.length) {
    showDone();
  } else if (state.index < state.items.length - 1) {
    state.index += 1;
    showCurrentItem();
  } else {
    showDone();
  }
}

function showDone() {
  hide("nameScreen");
  hide("ratingScreen");
  show("doneScreen");
  const count = answeredCount();
  const study = state.bundle.study;
  const noun = count === 1 ? study.item_term : study.item_term_plural;
  setText("completionSummary", `You rated ${count} of ${state.items.length} ${noun}.`);
  setText(
    "reviewButton",
    count < state.items.length ? `Continue with unanswered ${study.item_term_plural}` : "Review my answers",
  );
}

function reviewAnswers() {
  const firstUnanswered = state.order.findIndex(
    (itemIndex) => !(state.items[itemIndex].id in state.answers),
  );
  state.index = firstUnanswered === -1 ? 0 : firstUnanswered;
  showCurrentItem();
}

async function initialize() {
  const savedParticipant = localStorage.getItem("participantId") || localStorage.getItem("rater");
  if (savedParticipant) element("participantId").value = savedParticipant;

  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    state.authRequired = Boolean(config.auth_required);
    if (config.study_title) {
      setText("studyTitle", config.study_title);
      document.title = config.study_title;
    }
    if (state.authRequired) {
      show("passcodeRow");
      const savedPasscode =
        localStorage.getItem("participantPasscode") || localStorage.getItem("passcode");
      if (savedPasscode) element("passcode").value = savedPasscode;
    }
    if (!config.ready) {
      setText(
        "studyDescription",
        "The study is not ready. A researcher must configure the passcodes and upload a study bundle.",
      );
    }
  } catch {
    setText("studyDescription", "The study configuration could not be loaded.");
  }
}

element("startButton").addEventListener("click", startStudy);
element("participantId").addEventListener("keydown", (event) => {
  if (event.key === "Enter") startStudy();
});
element("passcode").addEventListener("keydown", (event) => {
  if (event.key === "Enter") startStudy();
});
element("nextButton").addEventListener("click", async () => {
  if (await saveCurrentItem()) advance();
});
element("skipButton").addEventListener("click", () => {
  if (state.index < state.items.length - 1) {
    state.index += 1;
    showCurrentItem();
  } else {
    showDone();
  }
});
element("previousButton").addEventListener("click", () => {
  if (state.index > 0) {
    state.index -= 1;
    showCurrentItem();
  }
});
element("reviewButton").addEventListener("click", reviewAnswers);

initialize();
