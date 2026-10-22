# Zeporah Enterprise: demo rehearsal, 2026-10-22

The 15-minute Okafor walkthrough ([enterprise-demo-map.md](enterprise-demo-map.md), "Presenting it
in about 15 minutes") run end to end on the isolated review server (port 3200, its own database),
after a clean full test run. Synthetic data only. Desktop beats at 1440×900, phone at 375×812, iPad
at 768×1024.

## How it was timed

App response times are measured in the browser. Presenter times are estimates: a person reading the
talk track, clicking, switching persona and changing device. An agent driving a browser isn't a
presenter, so those figures are a model, not a stopwatch.

Every app action responded quickly: snapshot reset 1.1 s, sign-in 0.3–0.9 s, Catch me up 0.06 s,
send 0.1 s, activation 1.3 s, page loads under 0.1 s. **The overrun comes from the script and the
persona switching, not the app.**

## Timing

| Beat                        | Budget    | Estimate  | Main cost                                                     |
| --------------------------- | --------- | --------- | ------------------------------------------------------------- |
| 1. Two front doors          | 0:30      | 0:45      | Reset toast on the first screen; phone, then laptop           |
| 2. Maya's home              | 1:00      | 1:15      | Persona scroll (S-2); explaining 14 items                     |
| 3. The Okafor record        | 2:00      | 2:15      | Households, then the record; seven summary lines              |
| 4. Who can see what         | 1:00      | 1:00      | None. Strong beat                                             |
| 5. A reply that was waiting | 1:00      | 1:45      | Switching to Ada's phone                                      |
| 6. Consent, end to end      | 2:00      | 3:00      | Maya, Ada, Priya: three switches; Oakwood not on Priya's home |
| 7. Recipient portal         | 1:00      | 1:15      | Switching to Rosa; two packets to choose from                 |
| 8. Planned absence          | 2:00      | 2:45      | The "Temporary until…" moment can't be shown (S-11)           |
| 9. End-of-week snapshot     | 1:00      | 1:15      | Stalled handoff isn't in Resolved (S-12)                      |
| 10. Audit                   | 2:00      | 2:00      | Two counts to explain                                         |
| 11. Governance              | 1:00      | 1:15      | Typing a household URL to show the refusal                    |
| **Total**                   | **14:30** | **18:30** | About 10 persona switches at ~15 s each is 2:30 of it         |

## Stumble points and fixes

**Blocking (the script promises something the screen can't show)**

- **S-11, beat 8.** "Who can see what shows 'Temporary until…'" can't happen. After Sofia
  accepts on Day 4, her cover starts Day 5, so she gets "This isn't available" (correct under
  decision 59). Operations' Who can see what doesn't list her either, because only started cover is
  listed. Neither snapshot falls inside the cover window. _Fix:_ list accepted cover that hasn't
  started as "Temporary, from … until …" in Who can see what (display only; no access before the
  start). Meanwhile, show the Team & coverage board instead.
- **S-12, beat 9.** "Stalled handoff and Let it end, both in the Resolved list." Only Let it end is
  there. Rerouting a stalled handoff is recorded as an assignment and a withdrawal, which Resolved
  doesn't list. _Fix:_ list a withdrawn or reassigned handoff that cleared a Stalled handoff, or
  change the script.

**Wrong or contradictory on screen**

- **S-7, beat 6.** After Ada confirms, the Missing consent row's chip still says "Waiting for
  household confirmation" (it's fixed in code), while its "Based on" line says it's waiting for a
  reviewer. _Fix:_ take the chip from the pending consent's stage.
- **S-9, beat 8.** The prepared handoff note says "Oakwood's delivery is waiting on the new
  consent", minutes after the audience watched Priya activate it. _Fix:_ drop that sentence from
  the synthetic draft.
- **S-13, beat 9.** "Reached by phone" is listed as a resolution, but since quality-pass fix Q-1
  the update stays open for the others who haven't acknowledged it. _Fix:_ list it as "Call
  recorded (Daniel Okafor)", or only when the row actually cleared.
- **S-10, beat 8.** Dana's Coverage widget says "Maya Chen is away" on Day 4; she's away from
  Day 5. _Fix:_ "Maya Chen will be away from Oct 23".

**Pacing and transitions**

- **S-2, every switch.** The persona buttons sit 2,440 px down the family front door, and the
  care-team sign-in has none, so becoming Maya means going back to the family door you just
  contrasted it with. _Fix:_ a development-only staff persona list on the care-team sign-in page, and
  the family list near the top. Or one browser profile per persona, with no code change. Saves about
  2 minutes.
- **S-5, beats 5–6.** The order Maya → Ada → Maya → Ada → Priya switches device twice for one
  story. _Fix:_ show Missing consent and log the partner event in beat 3, while on Maya's record.
  Then beat 5 ends on Ada's phone, where she reads the reply and confirms Oakwood in one visit.
  Then Priya. Saves about 45 seconds.
- **S-8, beat 6.** Oakwood isn't on Priya's home (a backlog of 10, oldest first), and activating
  takes two clicks: the row opens the panel, then Activate. _Fix:_ the script goes straight to
  Exceptions › Consent & access.
- **S-1, beat 1.** The "Synthetic data was reset." toast covers the first screen. _Fix:_ reset in
  another tab before presenting, or dismiss it.

**Weak beats or wording**

- **S-3, beat 2.** The script says "a reason on every row"; the home rows show category, title and
  age only (the reason is in Exceptions). The oldest row reads "Access ending … open for 5 days" for
  access that ends in two days. Oakwood's Missing consent isn't in the top three. _Fix:_ for access
  ending, show "ends in 2 days" instead of an age; script: "open any row to see why".
- **S-4, beat 3.** Catch me up reads "Latest from outside (simulated): Brightwater …, status." (an
  internal kind) and stacks brackets: "Brightwater Respite House (synthetic) (“…”)". _Fix:_ plain
  labels for partner event kinds; one bracket level.
- **S-14, beat 10.** "Audit chain verified · 71 events" next to "30 events in the last 7 days":
  the 71 covers the whole hospice, but nothing says so. The script quotes "All entries are intact"
  and "recorded by Maya, activated by Priya"; the screen says "Audit chain verified" and
  "Requested by … Approved by …". _Fix:_ label the chain count; update the script's quotes.
- **S-15, beat 11.** Lena has no in-app path to try a household, and the refusal is the generic
  "may not be assigned to you … your care team can help", with a "Back to households" link to a
  section administrators don't have. _Fix:_ an administrator-specific refusal (decision 39) linking
  back to Administration.
- **S-6, beat 6.** Ada's deep link scrolls 172 px past the top of the Oakwood card, hiding its
  name. _Fix:_ a scroll margin on consent anchors.
- **S-16, beat 3.** A click on Catch me up within a moment of the page loading did nothing (before
  the page was interactive). _Fix:_ none needed; pause after each navigation.

**Strong beats:** Who can see what (4), the activation confirmation (6), the recipient portal (7),
the cover offer and acceptance dialogs (8), the audit filter to two-person approvals (10), and the
administrator home with no household names (11).

## R-07 (clinical leadership, counts only)

The rehearsal doesn't show that a leadership view is needed to complete the story. All 11 beats
land without it: operations proves what happened (beats 9–10), and the administrator shows
governance without household names (beat 11). The cross-hospice counts a leadership role would see
already exist for operations (Where work is waiting, Reports). The gaps that would cost the demo
are S-11, S-12, S-7 and S-9, all design fixes needing no decision. **R-07 isn't recorded.**

When it comes back, a concrete definition to decide on:

- **Visible:** Reports counts across the hospice. These are exceptions by category and age band,
  median time to first reply, handoff acceptance time, consents activated, releases, access ended on
  time, and prepared work used. Any figure under 5 is shown as "fewer than 5".
- **Hidden:** household, patient and family names; any record, message, note, packet or timeline;
  Who can see what; individual staff names outside the existing workforce report.
- **Not allowed:** opening a household; acting on exceptions (take, assign, dismiss); releases,
  activations and settings; and exports.

## Second rehearsal, after the demo-fix pass (2026-10-22)

All 16 stumbles fixed in the order asked: the two promised moments (S-11, S-12), contradictions
(S-7, S-9, S-13, S-10), persona switching (S-2), pacing (S-5, S-8, S-1, in the script), then wording
(S-3, S-4, S-14, S-15, S-6; S-16 needed nothing). No founder decision changed. Full suite before the
rehearsal: 487 unit and integration, 185 end-to-end (1 skipped), 22 verify, 10 upgrade; development
database unchanged. Regression tests for the fixes are in `direction-refinements.test.ts`.

| Beat                      | Budget    | Estimate  | Notes                                                                         |
| ------------------------- | --------- | --------- | ----------------------------------------------------------------------------- |
| 1. Two front doors        | 0:30      | 0:30      | Clean first screen; the care-team page's persona link lands on Maya           |
| 2. Maya's home            | 1:00      | 1:00      | Access ending says "ends Oct 23, 6:00 PM ET"                                  |
| 3. The record             | 2:30      | 2:45      | Longest beat: Catch me up, context by question, Missing consent, a live event |
| 4. Who can see what       | 1:00      | 1:00      | Unchanged                                                                     |
| 5. Reply and confirmation | 1:30      | 1:45      | One phone visit: Ada reads the reply and confirms; card title in view         |
| 6. Activation             | 1:00      | 1:00      | Both Oakwood rows read "Confirmed — ready to activate", then clear            |
| 7. Recipient portal       | 1:00      | 1:00      | Unchanged                                                                     |
| 8. Planned absence        | 2:00      | 2:30      | "Will be away soon"; clean note; Dana sees "Temporary from … until …"         |
| 9. End of week            | 1:00      | 1:00      | "Stalled handoff rerouted" and "Let it end" in Resolved                       |
| 10. Audit                 | 2:00      | 2:00      | "71 events across the hospice"; "Requested by Maya Chen, Approved by Priya…"  |
| 11. Governance            | 1:00      | 0:45      | The administrator-specific refusal, with Back to Administration               |
| **Total**                 | **14:30** | **15:15** | Persona switches are now one link and one click (~5 s each)                   |

**All 11 beats are demonstrable.** Screenshot 21 shows beat 8's arranged cover.

**Still awkward (none blocking):**

- Resolved footers read "Resolved by dismissed", "Resolved by stalled handoff rerouted": the label
  is repeated as a verb. Drop "Resolved by …" to "who · when".
- The administrator refusal keeps the generic line "If you think it should be, your care team can
  help." under the new message.
- The Temporary label wraps to three lines inside a rounded pill in Who can see what.
- Beat 3 carries four things; if time is short, skip the live partner event (about 30 s).
- Activation is still two clicks from the list (the row opens the panel; Activate is inside).
- Beat 8 needs a switch back to Dana, because Sofia can't open the household before her cover
  starts (decision 59, by design).

**R-05:** beat 8 now shows cover arranged for Okafor two days out, which invites the question
"does the family know Sofia is their care guide on Thursday and Friday?" The family app says
nothing, as decided until R-05. It doesn't block the beat; it's the decision the demo most visibly
raises. R-07 stays held.
