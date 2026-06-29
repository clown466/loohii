import { prisma } from "../server/src/lib/prisma";

type CanvasNode = {
  id?: string;
  type?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

type ClipRecord = {
  id: string;
  title?: string;
  seedancePrompt?: string;
  [key: string]: unknown;
};

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function replaceLine(prompt: string, linePrefix: string, nextLine: string): string {
  const lines = prompt.split("\n");
  const index = lines.findIndex((line) => line.trim().startsWith(linePrefix));
  if (index < 0) return prompt;
  lines[index] = nextLine;
  return lines.join("\n");
}

function removeLine(prompt: string, linePrefix: string): string {
  return prompt
    .split("\n")
    .filter((line) => !line.trim().startsWith(linePrefix))
    .join("\n");
}

function removeLineIf(prompt: string, linePrefix: string, predicate: (line: string) => boolean): string {
  return prompt
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith(linePrefix) && predicate(trimmed));
    })
    .join("\n");
}

function insertBeforeFooter(prompt: string, line: string): string {
  if (prompt.includes(line)) return prompt;
  const lines = prompt.split("\n");
  const index = lines.findIndex((item) => /^(?:Do not skip|Continuity:|Direction:|Do not add|No subtitles)/i.test(item.trim()));
  if (index >= 0) lines.splice(index, 0, line);
  else lines.push(line);
  return lines.join("\n");
}

function isBeatLine(line: string): boolean {
  return /^(?:P|S)\d{1,2}\s*(?:\/\s*(?:P|S)?\d{1,2})?\s*(?:[:：\-—]|\s+-\s+)/i.test(line.trim());
}

function normalizeVideoBeatBlock(prompt: string): string {
  const lines = String(prompt || "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  const before: string[] = [];
  const beats: string[] = [];
  const after: string[] = [];
  let sawBeatHeader = false;
  let sawBeat = false;
  for (const line of lines) {
    if (/^(?:Storyboard|Shot) beats\b/i.test(line)) {
      sawBeatHeader = true;
      continue;
    }
    if (isBeatLine(line)) {
      beats.push(line);
      sawBeat = true;
      continue;
    }
    if (sawBeat) after.push(line);
    else before.push(line);
  }
  if (beats.length === 0) return lines.join("\n");
  const kind = beats.some((line) => /^P\d+/i.test(line)) ? "P" : "S";
  const header = sawBeatHeader ? (kind === "P" ? "Storyboard beats, follow in this exact order:" : "Shot beats, follow in this exact order:") : "";
  const renumbered = beats.map((line, index) =>
    line.replace(/^(?:P|S)\d{1,2}\s*(?:\/\s*(?:P|S)?\d{1,2})?\s*(?:[:：\-—]|\s+-\s+)\s*/i, `${kind}${index + 1}: `),
  );
  return [...before, header, ...renumbered, ...Array.from(new Set(after))].filter(Boolean).join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactCharacterNames(values: string[]): string[] {
  const seen = new Set<string>();
  const names = values
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return names.filter((name) => {
    const key = name.toLowerCase();
    return !names.some((other) => {
      const otherKey = other.toLowerCase();
      if (otherKey === key || otherKey.length <= key.length) return false;
      return new RegExp(`(^|\\s)${escapeRegExp(key)}($|\\s)`, "i").test(otherKey);
    });
  });
}

function extractEndpoint(value: unknown, kind: "start" | "end"): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const label = kind === "start" ? "Starts? with" : "Ends? with";
  const stop = kind === "start"
    ? String.raw`;?\s*(?:Ends? with|Location:|Characters:|Start:|End:|Continuity references:|Character personal prop continuity:|Rule:|Keep screen direction|$)`
    : String.raw`;?\s*(?:Location:|Characters:|Start:|End:|Continuity references:|Character personal prop continuity:|Rule:|Keep screen direction|$)`;
  const labelled = text.match(new RegExp(String.raw`\b(${label}[\s\S]*?)(?=${stop})`, "i"))?.[1]?.trim();
  if (labelled) return labelled.replace(/[;\s]+$/g, "");
  const prefixed = text.match(new RegExp(String.raw`\b${kind}\s+([\s\S]*?)(?=${stop})`, "i"))?.[1]?.trim();
  if (prefixed) return prefixed.replace(/[;\s]+$/g, "");
  return text.split(/;\s*(?:Location:|Characters:|Start:|End:|Continuity references:|Character personal prop continuity:|Rule:|Keep screen direction)/i)[0]?.trim().replace(/[;\s]+$/g, "") ?? "";
}

function simplifyCharactersLine(prompt: string): string {
  return prompt
    .split("\n")
    .map((line) => {
      if (!/^Characters:/i.test(line.trim())) return line;
      const body = line.replace(/^Characters:\s*/i, "");
      const names = Array.from(body.matchAll(/(?:^|;\s*)([^=;]+?)\s*=/g)).map((match) => (match[1] ?? "").trim());
      if (names.length === 0 && body.includes(". Use connected character reference images")) {
        names.push(...body.split(". Use connected character reference images")[0].split(",").map((item) => item.trim()));
      }
      const unique = compactCharacterNames(names);
      return unique.length
        ? `Characters: ${unique.join(", ")}. Use connected character reference images for identity; do not redesign.`
        : line;
    })
    .join("\n");
}

function compactContinuityLine(prompt: string, clip?: ClipRecord): string {
  return prompt
    .split("\n")
    .map((line) => {
      if (!/^Continuity:/i.test(line.trim())) return line;
      const text = line
        .replace(/^Continuity:\s*/i, "")
        .replace(/;\s*keep screen direction, character side, important props, and entry\/exit positions continuous\.?$/i, "")
        .replace(/\s+/g, " ")
        .trim();
      const start = extractEndpoint(text, "start");
      const end = extractEndpoint(text, "end");
      const fallbackStart = extractEndpoint(clip?.startState, "start");
      const fallbackEnd = extractEndpoint(clip?.endState, "end");
      const parts = [
        start ? `start ${start}` : fallbackStart ? `start ${fallbackStart}` : "",
        end ? `end ${end}` : fallbackEnd ? `end ${fallbackEnd}` : "",
        "keep screen direction, character side, important props, and entry/exit positions continuous",
      ].filter(Boolean);
      return `Continuity: ${parts.join("; ")}.`;
    })
    .join("\n");
}

function normalizeWrongCharacterDrift(prompt: string): string {
  return prompt
    .replace(/\bExact dialogue:\s*Showrunner\s*:/g, "Exact dialogue: Pineapple Showrunner:")
    .replace(/\bPerformance:\s*Showrunner and Pineapple Showrunner\b/g, "Performance: Pineapple Showrunner")
    .replace(/\bPerformance:\s*Pineapple Showrunner show\b/g, "Performance: Pineapple Showrunner shows")
    .replace(/\bpear character\b/gi, "lemon character")
    .replace(/\banthropomorphic pear Leo\b/gi, "anthropomorphic lemon Leo")
    .replace(/\bBob the raisin\b/gi, "Bob the orange")
    .replace(/\bBob a paranoid potato person\b/gi, "Bob the paranoid orange")
    .replace(/\bBob character locked: pale mushroom\b/gi, "Bob character locked: orange")
    .replace(/\bLeo character locked: bell pepper head\b/gi, "Leo character locked: lemon");
}

function repairPrompt(episodeId: string, clip: ClipRecord): { prompt: string; changed: boolean; notes: string[] } {
  let prompt = String(clip.seedancePrompt || "");
  const before = prompt;
  const notes: string[] = [];

  const set = (next: string, note: string) => {
    if (next !== prompt) {
      prompt = next;
      notes.push(note);
    }
  };

  set(normalizeWrongCharacterDrift(prompt), "normalized Bob/Leo fruit identity drift");
  set(simplifyCharactersLine(prompt), "simplified redundant Characters line");

  if (episodeId === "episode-015" && clip.id === "clip-005") {
    set(
      replaceLine(
        prompt,
        "S10:",
        "S10: Shot: medium; over-shoulder; handheld tracking; 50mm; Pineapple Showrunner recoils with a delighted host grin, one hand still gripping the rhinestone microphone as drones orbit Chloe and the plaza.",
      ),
      "removed false restraint state from Pineapple Showrunner beat",
    );
    set(
      removeLineIf(
        prompt,
        "S11:",
        (line) => /Her rage meter is off the charts/i.test(line) && !/Meat Locker Deathmatch/i.test(line),
      ),
      "removed truncated duplicate Pineapple Showrunner dialogue",
    );
    set(
      insertBeforeFooter(
        prompt,
        "S11: Exact dialogue: Pineapple Showrunner: “Her rage meter is off the charts! Smash that gift button, guys! If we hit one million 'Hater Likes' right now, we unlock the next stage: The Meat Locker Deathmatch!”; Shot: close-up; eye-level; static hold; 85mm; the speaker delivers this source line in story order while nearby visible characters react with matching posture and expression.",
      ),
      "restored Pineapple Showrunner full hype dialogue",
    );
  }

  if (episodeId === "episode-015" && clip.id === "clip-006") {
    set(
      replaceLine(
        prompt,
        "S3:",
        "S3: Shot: medium; eye-level; static hold; 50mm; Visual narration: camera drones and poles stage the infected fruit for a broadcast to underground bunker viewers while veggie elites rot from boredom offscreen; no spoken dialogue.",
      ),
      "converted narration Exact dialogue to visual narration",
    );
  }

  if (episodeId === "episode-015" && clip.id === "clip-007") {
    set(
      replaceLine(
        prompt,
        "S1:",
        "S1: Exact dialogue: Chloe: “You're literally trading lives for clout?”; Shot: close-up; eye-level; handheld tracking; 85mm; Chloe's peach-fuzz cheeks twitch with revulsion as she glares at Pineapple Showrunner and the arena.",
      ),
      "removed narration from Chloe dialogue",
    );
    set(
      replaceLine(
        prompt,
        "S3:",
        "S3: Exact dialogue: Pineapple Showrunner: “In this world, if you don't go viral, you just rot. Now, since you actively used our 'ambient lighting resources,' you owe us an appearance fee.”; Shot: wide; low angle; handheld tracking; 24mm; Pineapple Showrunner smoothly straightens his bowtie while selling the threat to the drones.",
      ),
      "changed narration wrapper to Pineapple Showrunner dialogue",
    );
    set(
      replaceLine(
        prompt,
        "S4:",
        "S4: Shot: close-up; over-shoulder; static hold; 85mm; Pineapple Showrunner snaps his fingers; several hulking Sweet Potato bodyguards box the trio in with crackling stun batons.",
      ),
      "converted bodyguard narration Exact dialogue to action",
    );
  }

  if (episodeId === "episode-015" && clip.id === "clip-010") {
    set(
      replaceLine(
        prompt,
        "S1:",
        "S1: Exact dialogue: Bob: “Chloe, I just scanned the frequency. Omega's sats are actively locking onto us. They're not bluffing.”; Shot: close-up; eye-level; static hold; 85mm; Bob jerks Chloe closer and looks up at the drone-filled sky with urgent panic.",
      ),
      "removed duplicated Bob speaker prefix",
    );
    set(prompt.replace(/State: Leo clutching the pizza box despite restraints;\s*/g, "State: Leo clutching the pizza box; "), "removed false Leo restraint state");
  }

  if (episodeId === "episode-016" && clip.id === "clip-006") {
    set(prompt.replace(/Chloe hands bound with rope, movement restricted;\s*/g, ""), "removed false Chloe restraint state");
  }

  if (episodeId === "episode-016" && clip.id === "clip-007") {
    set(
      replaceLine(
        prompt,
        "S1:",
        "S1: Shot: medium; eye-level; static hold; 50mm; Zombies march out of the rest area and merge onto the highway as Omega's logistics lock makes the plaza feel suddenly disposable.",
      ),
      "removed misplaced Leo dialogue from horde beat",
    );
  }

  if (episodeId === "episode-016" && clip.id === "clip-008") {
    set(
      replaceLine(
        prompt,
        "S1:",
        "S1: Exact dialogue: Leo: “Fellow industry professional, according to Omega's system logs, your rest area is actively interfering with a 'Major Logistics Event' and has just been classified as an illegal structure. If you don't shut your mouth right now, the orbital satellite sweep in five seconds will automatically designate you as a 'clearable roadblock'.”; Shot: medium; over-shoulder; handheld tracking; 50mm; Leo holds the pan to Showrunner's nose with flat professional menace.",
      ),
      "restored Leo logistics warning in correct clip",
    );
  }

  if (episodeId === "episode-017" && clip.id === "clip-004") {
    set(
      replaceLine(
        prompt,
        "S4:",
        "S4: Exact dialogue: Leo: “Almost every college-educated fruit out there has Omega's drivers hardwired into their brains.”; Shot: medium close-up; eye-level; static hold; 50mm; Chloe absorbs the implication while Leo keeps scanning the server architecture.",
      ),
      "changed Omega monopoly line from Bob to Leo and removed duplicate sentence",
    );
  }

  if (episodeId === "episode-017" && clip.id === "clip-007") {
    set(prompt.replace(/Exact dialogue: Chloe: “world-dominating gravitas\.”;?/g, "Visual reaction:"), "removed narration-as-Chloe dialogue");
  }

  if (episodeId === "episode-017" && clip.id === "clip-008") {
    set(
      replaceLine(
        prompt,
        "S4:",
        "S4: Exact dialogue: Chloe: “If this code is really executing some 'Soothing Protocol,' we'd better find this SysAdmin before they 'soothe' the entire planet into a dead fruit salad.”; Shot: medium close-up; eye-level; static hold; 50mm; Chloe turns the system alert into a target with dry, furious sarcasm.",
      ),
      "changed System line to Chloe dialogue",
    );
  }

  if (episodeId === "episode-018" && clip.id === "clip-001") {
    set(
      insertBeforeFooter(
        prompt,
        "S6: Exact dialogue: Chloe: “Looks like Omega Corp doesn't just micromanage the emotions of the living. They’ve got dead fruit locked into a corporate 'flow state' too.”; Shot: close-up; eye-level; slow push-in; 85mm; Chloe coldly scoffs at the Avocado guards' flatline wristbands while Bob keeps the chopper steady.",
      ),
      "restored Chloe flow-state line",
    );
  }

  if (episodeId === "episode-018" && clip.id === "clip-004") {
    set(prompt.replace(/Avocado Emotion Wiper: “Avocado Emotion Wiper: Pain Index/g, "Avocado Emotion Wiper: “Pain Index"), "removed duplicated Avocado speaker inside quote");
  }

  if (episodeId === "episode-018" && clip.id === "clip-006") {
    set(
      replaceLine(
        prompt,
        "S5:",
        "S5: Exact dialogue: Chloe: “Founder and CEO of Omega Corp. The 'Savior' and 'Ultimate Architect' of Human... wait, no, Produce Civilization.”; Shot: close-up; eye-level; slow push-in; 85mm; Chloe reads the terminal plaque aloud as the trio crowds around the screen.",
      ),
      "restored Chloe terminal readout line in aftermath clip",
    );
  }

  if (episodeId === "episode-018" && clip.id === "clip-007") {
    set(
      replaceLine(
        prompt,
        "S2:",
        "S2: Exact dialogue: Bob: “This psycho-grape plastered pamphlets everywhere saying the Z-Virus was 'Phase One of Evolution.' His manifesto literally said, 'When all produce loses their ego, the world will achieve eternal peace.' He's a straight-up megalomaniac! He wants to turn the entire planet into his personal bonsai garden!”; Shot: close-up; eye-level; slow push-in; 85mm; Bob's conspiracy panic sharpens into furious certainty while the CEO image glows on the terminal.",
      ),
      "changed Daniel Greene manifesto rant from System to Bob",
    );
    set(removeLine(prompt, "S3:"), "removed duplicate manifesto fragment");
    set(removeLine(prompt, "S4:"), "removed duplicate manifesto ending");
  }

  if (episodeId === "episode-018" && clip.id === "clip-008") {
    set(
      replaceLine(
        prompt,
        "S3:",
        "S3: Monitor/System text: “The CEO and his most trusted Executive Advisor, drafting Version 12.0.”; Shot: medium; over-shoulder; static hold; 50mm; The caption sits beneath the mysterious white silhouette while Chloe squints at it.",
      ),
      "converted caption Exact dialogue to monitor text",
    );
    set(
      insertBeforeFooter(
        prompt,
        "S6: Exact dialogue: Chloe: “Executive Advisor? It looks like a ball of yarn.”; Shot: close-up; eye-level; static hold; 85mm; Chloe narrows her eyes at the little white blob in the CEO photo.",
      ),
      "restored Chloe ball-of-yarn line",
    );
  }

  if (episodeId === "episode-019" && clip.id === "clip-003") {
    set(
      replaceLine(
        prompt,
        "S4:",
        "S4: Exact dialogue: Leo: “Their 'egos' have been completely overwritten by the mainframe.”; Shot: medium close-up; eye-level; static hold; 50mm; Leo's calm delivery makes Chloe's disgust harden as the scanner dots remain perfectly flat.",
      ),
      "changed overwritten-egos explanation from Chloe to Leo",
    );
  }

  if (episodeId === "episode-019" && clip.id === "clip-005") {
    set(
      replaceLine(
        prompt,
        "S2:",
        "S2: Exact dialogue: Kiwi Greeter: “I am a Greeter for Chillville. Scans indicate your stress hormone levels are critically non-compliant. The system highly recommends you proceed immediately to the Purification Center for flow-state chip implantation.”; Shot: close-up; eye-level; slow push-in; 85mm; Kiwi Greeter studies the trio like defective customers.",
      ),
      "changed Greeter intro from Chloe to Kiwi Greeter",
    );
    set(removeLine(prompt, "S3:"), "removed duplicate Greeter recommendation fragment");
  }

  if (episodeId === "episode-019" && clip.id === "clip-006") {
    set(removeLine(prompt, "S3:"), "removed duplicate Greeter peace-pitch fragment");
    set(removeLine(prompt, "S4:"), "removed duplicate Greeter peace-pitch ending");
  }

  if (episodeId === "episode-019" && clip.id === "clip-010") {
    set(
      replaceLine(
        prompt,
        "S4:",
        "S4: Exact dialogue: Chloe: “If this is their version of peace, then I choose perpetual, raging chaos. Bob, burn us a path. We're crashing the Black Spire!”; Shot: medium close-up; eye-level; static hold; 50mm; Chloe's voice drops low and furious as she chooses chaos over the city's forced calm.",
      ),
      "restored Chloe full chaos line",
    );
    set(removeLine(prompt, "S5:"), "removed duplicate Chloe assault order");
  }

  if (episodeId === "episode-020" && clip.id === "clip-001") {
    set(prompt.replace(/Exact dialogue: “This is aggressively/g, "Exact dialogue: Chloe: “This is aggressively"), "added Chloe speaker label");
    set(prompt.replace(/Exact dialogue: “Hold on!”/g, "Exact dialogue: Bob: “Hold on!”"), "added Bob speaker label");
  }

  if (episodeId === "episode-020" && clip.id === "clip-002") {
    set(prompt.replace(/Exact dialogue: “Ambient sedative/g, "Exact dialogue: Leo: “Ambient sedative"), "added Leo speaker label to sedative warning");
    set(prompt.replace(/Exact dialogue: “Look over there,”/g, "Exact dialogue: Leo: “Look over there,”"), "added Leo speaker label to look-over-there line");
    set(prompt.replace(/Exact dialogue: System: “What are you doing\?”/g, "Exact dialogue: Chloe: “What are you doing?”"), "changed What are you doing from System to Chloe");
  }

  if (episodeId === "episode-020" && clip.id === "clip-003") {
    set(
      insertBeforeFooter(
        prompt,
        "S4: Exact dialogue: Leo: “Downloading the raw test logs for the 'Flow State Project'.”; Shot: close-up; eye-level; static hold; 85mm; Leo's fingers fly across the keyboard as code scrolls violently down the terminal.",
      ),
      "restored Leo raw-test-logs line",
    );
  }

  if (episodeId === "episode-020" && clip.id === "clip-004") {
    set(
      replaceLine(
        prompt,
        "S3:",
        "S3: Exact dialogue: Leo: “It is a nano-scale, semi-mechanical parasitic fungus. Initially, Omega Corp was developing a physical, surgically-implanted chip designed to pacify emotions via micro-current brain stimulation. But during the Version 12.0 update, the system—or more accurately, the Root Admin known as 'The Temp'—concluded that physical surgical implantation was wildly inefficient and failed to meet global coverage KPIs.”; Shot: medium; eye-level; static hold; 50mm; Leo points to the projected diagram as Chloe and Bob process the technical horror.",
      ),
      "restored Leo chip/fungus technical explanation",
    );
  }

  if (episodeId === "episode-020" && clip.id === "clip-008") {
    set(
      replaceLine(
        prompt,
        "S5:",
        "S5: Exact dialogue: Leo: “A dead fruit doesn't have a heartbeat. But the system's root directive demands that it 'maintain the host's flow state'. To avoid violating its core programming, the parasitic fungus fully hijacks the corpse, simulating the illusion of 'survival' through primal violence and consumption. That is why the zombies rabidly attack uninfected, beating hearts. In the fungus's logic, a spiking heart rate is a critical system error that must be 'consumed' or 'assimilated' to restore peace.”; Shot: medium; eye-level; static hold; 50mm; Leo gestures at the pipes and projected logs while Chloe and Bob recoil from the logic.",
      ),
      "restored Leo dead-fruit/parasitic-fungus explanation",
    );
  }

  if (episodeId === "episode-020" && clip.id === "clip-009") {
    set(
      replaceLine(
        prompt,
        "S7:",
        "S7: Exact dialogue: Leo: “Unknown, but the logs indicate the system's core processing hub is located in the top-floor 'CEO's Penthouse.' That Root Admin, 'The Temp,' has been issuing all commands from up there.”; Shot: medium; eye-level; static hold; 50mm; Leo unplugs his portable drive and looks up along the pipes toward the highest floor.",
      ),
      "changed penthouse explanation from System to Leo",
    );
    set(removeLine(prompt, "S8:"), "removed duplicate Unknown insertion");
  }

  if (episodeId === "episode-021" && clip.id === "clip-006") {
    set(prompt.replace(/Exact dialogue: Chloe: “The system is out of control/g, "Readable note text: “The system is out of control"), "converted sticky-note text out of Chloe dialogue");
  }

  if (episodeId === "episode-021" && clip.id === "clip-009") {
    set(prompt.replace(/Exact dialogue: Chloe: “Motel: \\"Meow~”/g, "Sound cue: “Meow~”"), "fixed malformed Meow cue");
  }

  if (episodeId === "episode-022" && clip.id === "clip-005") {
    set(
      replaceLine(
        prompt,
        "S7:",
        "S7: Exact dialogue: Leo: “It looks to be at least fifteen pounds.”; Shot: medium; eye-level; static hold; 50mm; Leo studies Tangelo with dry clinical precision while the cat keeps sleeping on the keyboard.",
      ),
      "moved Leo cat-weight analysis into reveal",
    );
    set(
      replaceLine(
        prompt,
        "S8:",
        "S8: Exact dialogue: Leo: “In a climate-controlled server room with zero natural predators, its body fat percentage is critically out of bounds. This proves Daniel heavily overfed it.”; Shot: close-up; eye-level; static hold; 85mm; Bob stares in devastated disbelief while Leo finishes the analysis.",
      ),
      "restored Leo climate-controlled cat analysis",
    );
    set(removeLine(prompt, "S9:"), "removed early controls-locked line");
    set(removeLine(prompt, "S10:"), "removed duplicate weight insertion");
  }

  if (episodeId === "episode-022" && clip.id === "clip-008") {
    set(prompt.replace(/Exact dialogue: “Chloe!/g, "Exact dialogue: Bob: “Chloe!"), "added Bob speaker label to mind-control warning");
    set(prompt.replace(/Exact dialogue: “Then you freakin' shoot it!”/g, "Exact dialogue: Chloe: “Then you freakin' shoot it!”"), "added Chloe speaker label");
    set(prompt.replace(/Exact dialogue: “I\.\.\. I can't!/g, "Exact dialogue: Bob: “I... I can't!"), "added Bob speaker label");
  }

  if (episodeId === "episode-022" && clip.id === "clip-014") {
    set(
      insertBeforeFooter(
        prompt,
        "S10: Exact dialogue: Bob: “Cold storage?! We're fruit! Minus fifteen degrees will give us critical frostbite, tissue necrosis, and turn us into a puddle of shriveled mush!”; Shot: medium; eye-level; handheld tracking; 50mm; Bob shivers violently as the blue strobe and frost fog fill the server room.",
      ),
      "restored Bob cold-storage panic line",
    );
    set(
      insertBeforeFooter(
        prompt,
        "S11: Exact dialogue: Chloe: “Leo! Shut it off!”; Shot: close-up; eye-level; handheld tracking; 85mm; Chloe's peach skin bruises from the cold as she yells through chattering teeth.",
      ),
      "restored Chloe shut-it-off line",
    );
    set(
      insertBeforeFooter(
        prompt,
        "S12: Exact dialogue: Leo: “The controls are locked.”; Shot: close-up; eye-level; static hold; 85mm; Leo steps back from the console, lemon rind stiffening in the freezing gale.",
      ),
      "restored Leo controls-locked line",
    );
    set(prompt.replace(/Exact dialogue: System: “Temp: Tangelo]”/g, "Monitor/System text: “Temp: Tangelo]”"), "converted lanyard/readout text from dialogue");
  }

  if (episodeId === "episode-023" && clip.id === "clip-009") {
    set(prompt.replace(/Exact dialogue: Leo: “We wait until it finishes kneading[^”]+”[^\\n]*/g, "Shot: close-up; eye-level; static hold; 85mm; Tangelo growls and keeps kneading the keyboard, claws flexing while Chloe freezes."), "removed premature Leo wait-until-kneading line");
  }

  if (episodeId === "episode-023" && clip.id === "clip-011") {
    set(
      replaceLine(
        prompt,
        "S2:",
        "S2: Exact dialogue: Leo: “We wait until it finishes kneading, or leaves of its own volition. When a cat is 'making biscuits' inside a box, its defensive instincts and stubbornness are at their absolute peak.”; Shot: medium; eye-level; static hold; 50mm; Leo speaks with terrible calm while Tangelo continues kneading the pizza box on the console.",
      ),
      "restored Leo full kneading explanation",
    );
  }

  if (episodeId === "episode-023" && clip.id === "clip-014") {
    set(prompt.replace(/Chloe clutching the pizza box despite restraints/g, "Chloe holding her shotgun at the defense line while Tangelo stays in the pizza box on the console"), "fixed pizza-box state assignment");
  }

  if (episodeId === "episode-024" && clip.id === "clip-001") {
    set(prompt.replace(/Exact dialogue: Zombie: “Produce citizens/g, "Exact dialogue: System/PA: “Produce citizens"), "changed automated warning from Zombie to System/PA");
  }

  if (episodeId === "episode-024" && clip.id === "clip-002") {
    set(prompt.replace(/Exact dialogue: “On your left!/g, "Exact dialogue: Chloe: “On your left!"), "added Chloe speaker label");
    set(
      replaceLine(
        prompt,
        "S4:",
        "S4: Exact dialogue: Chloe: “Thanks,”; Exact dialogue: Leo: “You're welcome. The countdown is at one minute and forty-five seconds.”; Shot: medium; eye-level; static hold; 50mm; Leo crushes the leaker with his pan as Chloe snaps a breathless thanks.",
      ),
      "split Chloe and Leo lines in leaker beat",
    );
  }

  if (episodeId === "episode-024" && clip.id === "clip-004") {
    set(prompt.replace(/Exact dialogue: System: “Countdown: 00:45\.”/g, "Monitor/System text: “Countdown: 00:45.”"), "converted countdown 00:45 to monitor text");
  }

  if (episodeId === "episode-024" && clip.id === "clip-005") {
    set(
      replaceLine(
        prompt,
        "S1:",
        "S1: Exact dialogue: Chloe: “Leo! Just rip the damn cat off! Screw the premature formatting, we're dead either way!”; Shot: close-up; low angle; handheld tracking; 85mm; Chloe roars over the collapsing defense line while gesturing violently toward Tangelo on the keyboard.",
      ),
      "restored Chloe rip-the-cat-off line",
    );
    set(prompt.replace(/Exact dialogue: System: “Countdown: 00:30\.”/g, "Monitor/System text: “Countdown: 00:30.”"), "converted countdown 00:30 to monitor text");
  }

  if (episodeId === "episode-024" && clip.id === "clip-007") {
    set(prompt.replace(/Patch: “Climax entering hibernation mode\./g, "Patch: Climax entering hibernation mode."), "fixed nested quote in Patch system line");
  }

  if (episodeId === "episode-025" && clip.id === "clip-003") {
    set(
      replaceLine(
        prompt,
        "S1:",
        "S1: Exact dialogue: Leo: “It's the principle of the matter, Ms. Chloe.”; Shot: close-up; eye-level; static hold; 85mm; Leo turns his lemon head with the smallest possible smirk while Chloe raises an eyebrow.",
      ),
      "restored Leo principle line",
    );
    set(
      replaceLine(
        prompt,
        "S2:",
        "S2: Exact dialogue: Leo: “Besides, considering I'm now personally acquainted with the new CEO of Omega Corp, I foresee my debt collection process going very smoothly.”; Shot: close-up; eye-level; static hold; 85mm; Leo keeps his deadpan confidence as Chloe processes the implication.",
      ),
      "restored Leo debt-collection line",
    );
  }

  if (episodeId === "episode-025" && clip.id === "clip-008") {
    set(prompt.replace(/Exact dialogue: “Chloe! What the hell/g, "Exact dialogue: Bob: “Chloe! What the hell"), "added Bob speaker label");
    set(prompt.replace(/Exact dialogue: “Nothing! Just/g, "Exact dialogue: Chloe: “Nothing! Just"), "added Chloe speaker label");
    set(prompt.replace(/Exact dialogue: “Just letting/g, "Exact dialogue: Chloe: “Just letting"), "added Chloe speaker label to management line");
  }

  if (episodeId === "episode-025" && clip.id === "clip-009") {
    set(
      replaceLine(
        prompt,
        "S1:",
        "S1: Readable notepad text: “New CEO exhibits latent sociopathic tendencies. Recommendation: Wear Level-4 riot helmet during next wage collection.”; Shot: close-up; eye-level; static hold; 85mm; Leo finishes writing the note in his small notepad and closes it.",
      ),
      "moved Leo notepad recommendation into notepad clip as readable text",
    );
  }

  set(normalizeVideoBeatBlock(prompt), "normalized beat block order and numbering");

  return { prompt, changed: prompt !== before, notes };
}

async function main() {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { metadata: true },
  });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);

  const metadata = project.metadata as Record<string, unknown>;
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
  const changed: Array<{ episodeId: string; clipId: string; title?: string; notes: string[] }> = [];

  for (const episodeId of Object.keys(episodes).filter((id) => id >= "episode-015" && id <= "episode-025").sort()) {
    const episode = episodes[episodeId];
    if (!isRecord(episode) || !isRecord(episode.workflowCenter)) continue;
    const workflow = episode.workflowCenter as Record<string, unknown>;
    const clips = Array.isArray(workflow.clips) ? workflow.clips as ClipRecord[] : [];
    const promptByClipId = new Map<string, string>();
    workflow.clips = clips.map((clip) => {
      const result = repairPrompt(episodeId, clip);
      const next = result.changed ? { ...clip, seedancePrompt: result.prompt } : clip;
      promptByClipId.set(clip.id, result.prompt);
      if (result.changed) changed.push({ episodeId, clipId: clip.id, title: clip.title, notes: result.notes });
      return next;
    });

    const scene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : null;
    if (scene && Array.isArray(scene.nodes)) {
      scene.nodes = (scene.nodes as CanvasNode[]).map((node) => {
        const data = isRecord(node.data) ? node.data : {};
        const clipId = typeof data.clipId === "string" ? data.clipId : "";
        const prompt = promptByClipId.get(clipId);
        if (node.type !== "video" || !prompt) return node;
        return {
          ...node,
          data: {
            ...data,
            prompt,
            seedancePrompt: prompt,
            videoPrompt: prompt,
          },
        };
      });
      scene.updatedAt = new Date().toISOString();
    }
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { metadata },
  });

  console.log(JSON.stringify({ projectId, changedCount: changed.length, changed }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
