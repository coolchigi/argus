import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLIENT_NAME_TOKEN, batchStatesFromResults, buildCopyText, findNamedSalutation, isDelivered } from "./briefs.ts";

describe("isDelivered", () => {
  it("counts an Argus send and a copy-out, and nothing else", () => {
    assert.equal(isDelivered("sent"), true);
    assert.equal(isDelivered("sent-externally"), true);
    for (const s of ["draft", "edited", "failed", "", null, undefined]) assert.equal(isDelivered(s), false);
  });
});

describe("buildCopyText", () => {
  it("swaps every mention of the client id for the token and keeps the token intact", () => {
    const text = buildCopyText({
      subject: "Update for C-109",
      body: "C-109's CRS score drops by 12 points.\n\nI recommend C-109 books a retest.",
      actions: ["Book a language retest"],
      clientId: "C-109",
    });
    assert.ok(!text.includes("C-109"));
    assert.equal(text.split(CLIENT_NAME_TOKEN).length - 1, 3);
    assert.match(text, /^Subject: Update for \[CLIENT NAME\]\n\n/);
    assert.match(text, /\n\nSuggested actions:\n- Book a language retest$/);
  });

  it("leaves a longer id that only starts with the client id alone", () => {
    const text = buildCopyText({ subject: "s", body: "C-1 and C-10 are different files.", actions: [], clientId: "C-1" });
    assert.ok(text.includes(`${CLIENT_NAME_TOKEN} and C-10`));
  });

  it("adds a greeting that carries the token when the body has none", () => {
    const text = buildCopyText({ subject: "s", body: "IRCC changed a rule.", actions: [], clientId: "C-1" });
    assert.ok(text.includes(`Hi ${CLIENT_NAME_TOKEN},\n\nIRCC changed a rule.`));
  });

  it("keeps a token the consultant already typed and adds no second greeting", () => {
    const text = buildCopyText({ subject: "s", body: `Dear ${CLIENT_NAME_TOKEN},\nNews.`, actions: [], clientId: "C-1" });
    assert.equal(text.split(CLIENT_NAME_TOKEN).length - 1, 1);
  });

  it("drops the actions block when every action is blank", () => {
    const text = buildCopyText({ subject: "s", body: "b", actions: ["  ", ""], clientId: "C-1" });
    assert.doesNotMatch(text, /Suggested actions/);
  });

  it("treats regex characters in the client id literally", () => {
    const text = buildCopyText({ subject: "s", body: "File a.b+c is affected. So is aXb+c.", actions: [], clientId: "a.b+c" });
    assert.ok(text.includes(`File ${CLIENT_NAME_TOKEN} is affected. So is aXb+c.`));
  });
});

describe("batchStatesFromResults", () => {
  it("maps each result to its row and never marks a missing result as sent", () => {
    const states = batchStatesFromResults(
      ["a", "b", "c"],
      [
        { briefId: "b", ok: false, error: "brief-already-sent" },
        { briefId: "a", ok: true, sentBodyHash: "h" },
      ],
    );
    assert.deepEqual(states.a, { status: "sent" });
    assert.deepEqual(states.b, { status: "failed", error: "Already sent" });
    assert.equal(states.c.status, "failed");
  });

  it("names an SES refusal without echoing the address", () => {
    const [s] = Object.values(batchStatesFromResults(["a"], [{ briefId: "a", ok: false, error: "Email address is not verified. The following identities failed the check: x@y.z" }]));
    assert.equal(s.error, "Email provider refused the address");
  });
});

describe("findNamedSalutation", () => {
  it("flags a greeting followed by a capitalised name", () => {
    assert.equal(findNamedSalutation("Dear Priya,\nIRCC changed a rule."), "Dear Priya");
    assert.equal(findNamedSalutation("Thanks for waiting. Hi Mr. Sandhu, here's the news."), "Hi Mr. Sandhu");
    assert.equal(findNamedSalutation("hello Aditya"), "hello Aditya");
    assert.equal(findNamedSalutation("Bonjour Élodie,"), "Bonjour Élodie");
  });

  it("lets the token, file numbers and generic greetings through", () => {
    assert.equal(findNamedSalutation(`Hi ${CLIENT_NAME_TOKEN},`), null);
    assert.equal(findNamedSalutation("Hi C-109,", "C-109"), null);
    assert.equal(findNamedSalutation("Hello there, and Hi Team."), null);
    assert.equal(findNamedSalutation("Dear client,"), null);
  });

  it("ignores capitalised words that don't follow a greeting", () => {
    assert.equal(findNamedSalutation("Express Entry draws resumed. Your CRS score is 481."), null);
    assert.equal(findNamedSalutation("This changes the Chipotle schedule."), null);
  });
});
