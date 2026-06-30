import assert from "node:assert/strict";
import test from "node:test";
import { TEAM_SCENE_PATTERN } from "./workflowPatterns.js";
import { workflowsTestInternals } from "./workflows";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("Dreamina Web video timeout without submit id is reported as not submitted", () => {
  const result = workflowsTestInternals.canvasVideoResultFailureMessage({
    provider: "dreamina-web",
    result: {
      genStatus: "missing-submit-id-timeout",
    },
  });

  assert.match(result, /未成功提交/);
  assert.match(result, /未拿到 submit_id/);
  assert.doesNotMatch(result, /后台处理中/);
});

test("Dreamina Web timeout with submit id keeps background-processing guidance", () => {
  const result = workflowsTestInternals.formatDreaminaGenerationFailure(new Error("TimeoutError: timed out while querying submit id abc"));

  assert.match(result, /可能仍在后台处理中/);
  assert.match(result, /submit_id/);
});

test("Dreamina Web creation failure exposes provider rejection details", () => {
  const result = workflowsTestInternals.canvasVideoResultFailureMessage({
    provider: "dreamina-web",
    result: {
      created: {
        statusCode: -6,
        errorMsg: "shark not pass reject",
        failStarlingMessage: "Couldn't generate due to unusual activity in your account. Try again later.",
      },
    },
  });

  assert.match(result, /shark not pass reject/);
  assert.match(result, /unusual activity/);
  assert.match(result, /code -6/);
});

test("Dreamina Web reference upload timeout is not reported as background generation", () => {
  const result = workflowsTestInternals.formatDreaminaGenerationFailure(
    new Error("Dreamina Web 参考素材上传到页面超时：本次 7 个文件，已等待 185 秒。素材还没成功进入 Dreamina 输入框，未提交生成，未拿到 submit_id；请减少参考素材或稍后重试。"),
  );

  assert.match(result, /参考素材上传到页面超时/);
  assert.match(result, /未提交生成/);
  assert.doesNotMatch(result, /可能仍在后台处理中/);
});

test("video prompt finalizer keeps P beats and exact dialogue under Dreamina Web limit", () => {
  const longPrompt = [
    "Generate one continuous 10-second vertical cinematic video, aspect ratio 9:16.",
    `Style: ${"masterpiece cinematic saturated dark-comedy 3D American animated sitcom ".repeat(45)}`,
    `Characters: Chloe = use Chloe's connected character reference image; Leo = use Leo's connected character reference image; Tiffany = use Tiffany's connected character reference image; Eugene = use Eugene's connected character reference image. ${"Keep identity locked. ".repeat(30)}`,
    `Scene: laser-filled cosmetic lab. ${"glossy beauty machinery, purple lasers, poster wall, continuity geography. ".repeat(30)}`,
    `P1 / S1 - Physics Hack: Camera medium shot. ${"Chloe aims upward, shotgun blast hits ceiling laser emitter, sparks fly. ".repeat(18)} Chloe: Then I will hack them with physics!`,
    `P2 / S2 - Poster Ruined: Camera medium shot. ${"Purple laser slices Tiffany poster while the team reacts. ".repeat(18)} Tiffany: You ruined my Photoshopped poster!!! Tiffany: That picture removed 50% of my wrinkles!!!`,
    `P3 / S3 - Face Cracks Open: Camera close-up. ${"Tiffany's fake beauty face fractures into shark-toothed rage mask, needle arms rise. ".repeat(18)} Tiffany: Die! You ugly haters!!!`,
  ].join("\n");

  const result = workflowsTestInternals.finalizeWorkflowVideoPrompt(longPrompt);

  assert.ok(result.length <= 3900, `expected <= 3900 chars, got ${result.length}`);
  assert.match(result, /P1:/);
  assert.match(result, /P2:/);
  assert.match(result, /P3:/);
  assert.match(result, /Chloe: “Then I will hack them with physics!”/);
  assert.match(result, /Tiffany: “You ruined my Photoshopped poster!!!/);
  assert.match(result, /Tiffany: “Die! You ugly haters!!!”/);
});

test("canvas video ratio resolves adaptive from prompt aspect ratio", () => {
  assert.equal(
    workflowsTestInternals.normalizeCanvasVideoRatio(
      "adaptive",
      "Generate one continuous video, aspect ratio 9:16.",
      "16:9",
    ),
    "9:16",
  );
  assert.equal(workflowsTestInternals.normalizeCanvasVideoRatio("16:9", "aspect ratio 9:16", "9:16"), "16:9");
});

test("Dreamina query raw extracts existing generated video urls", () => {
  const urls = workflowsTestInternals.dreaminaExistingVideoUrlsFromRaw({
    dom: {
      ignoredVideoUrls: [
        "https://v16-cc.capcut.com/old/video/tos/alisg/file.mp4?mime_type=video_mp4",
        "https://v16-cc.capcut.com/audio/ref.wav?mime_type=audio_wav",
      ],
    },
    result: {
      summary: JSON.stringify({
        dom: {
          ignoredVideoUrls: ["https://v16-cc.capcut.com/older/video/tos/alisg/file.mp4?mime_type=video_mp4"],
        },
      }),
    },
  });

  assert.deepEqual(urls.sort(), [
    "https://v16-cc.capcut.com/old/video/tos/alisg/file.mp4?mime_type=video_mp4",
    "https://v16-cc.capcut.com/older/video/tos/alisg/file.mp4?mime_type=video_mp4",
  ].sort());
});

test("prompt optimization cleaner extracts optimized prompt from json fences", () => {
  const result = workflowsTestInternals.cleanOptimizedPrompt('```json\n{"optimizedPrompt":"P1: staged comedy malfunction. Chloe: Keep moving!"}\n```');

  assert.equal(result, "P1: staged comedy malfunction. Chloe: Keep moving!");
});

test("prompt optimization detects missing character dialogue", () => {
  const missing = workflowsTestInternals.missingPreservedDialogueFragments(
    'P1: chaotic elevator motion. Exact dialogue: Chloe: Keep moving! Bob: I hate this place.',
    'P1: stylized elevator malfunction. Chloe: Keep moving!',
  );

  assert.deepEqual(missing, ["Bob: I hate this place."]);
});

test("prompt optimization dialogue guard ignores performance labels", () => {
  const missing = workflowsTestInternals.missingPreservedDialogueFragments(
    [
      "S1: Performance: Flora shows heightened ritual seriousness; Flora presents the living wall like a holy exhibit.",
      "S2: Exact dialogue: Flora: My dear children, thank you for your hard work today.",
    ].join("\n"),
    [
      "S1: Acting note: Flora maintains ritual seriousness beside the living wall.",
      "S2: Exact dialogue: Flora: My dear children, thank you for your hard work today.",
    ].join("\n"),
  );

  assert.deepEqual(missing, []);
});

test("TEAM_SCENE_PATTERN matches Chinese team keywords", () => {
  const cases = [
    "队员集合",
    "同伴们赶到",
    "伙伴一起行动",
    "团队作战",
    "一行人走进大厅",
    "众人围坐",
    "组员到齐",
    "全员出动",
    "同伙",
    "team assembles",
    "teammates arrive",
    "guests enter",
    "主角团出发",
    "小队集合",
  ];
  for (const text of cases) {
    assert.ok(TEAM_SCENE_PATTERN.test(text), `Should match: "${text}"`);
  }
});

test("TEAM_SCENE_PATTERN does not match unrelated text", () => {
  const cases = [
    "Leo walks alone",
    "一个人静静站着",
    "空旷的房间",
  ];
  for (const text of cases) {
    assert.ok(!TEAM_SCENE_PATTERN.test(text), `Should NOT match: "${text}"`);
  }
});

test("clipStoryboardDialogueLockLines preserves all dialogues with cross-references", () => {
  const shots = [
    { dialogue: "你好" },
    { dialogue: "再见" },
    { dialogue: "你好" },
    { dialogue: "" },
    { dialogue: "谢谢" },
  ] as any[];
  const lines = workflowsTestInternals.clipStoryboardDialogueLockLines(shots);
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^D1: 你好$/);
  assert.match(lines[1], /^D2: 再见$/);
  assert.match(lines[2], /D3: 你好 \(same as D1\)/);
  assert.match(lines[3], /^D4: 谢谢$/);
});

test("clipStoryboardDialogueLockLines returns empty for no-dialogue shots", () => {
  const shots = [{ dialogue: "" }, { dialogue: null }, {}] as any[];
  const lines = workflowsTestInternals.clipStoryboardDialogueLockLines(shots);
  assert.equal(lines.length, 0);
});

test("sourceDialogueLockLines ignores quoted terms but keeps attributed short dialogue", () => {
  const lines = workflowsTestInternals.sourceDialogueLockLines([
    'The high-level "botanized" cultists snapped awake.',
    '"Bob," Chloe said, turning toward him. "You got any rock salt left?"',
    'She was still "half-plugged in" to the mainframe.',
    "\"Let's move,\" Chloe said, racking her shotgun.",
  ].join("\n"));

  assert.deepEqual(lines, ["Bob,", "You got any rock salt left?", "Let's move,"]);
});

const internals = workflowsTestInternals;

const sampleShots = [
  {
    id: "s1", title: "Blast", description: "Chloe fires.", action: "Chloe fires. The zombie bursts.",
    dialogue: "Murder! Cold-blooded murder!", durationSeconds: 3,
    shotSize: "medium shot", cameraAngle: "eye level", cameraMove: "handheld", composition: "", lens: "50mm",
    aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
    characters: ["Flora"], setting: "Underground Loading Dock", references: "",
  },
  {
    id: "s2", title: "Rack", description: "Flora points.", action: "Flora points, hands shaking.",
    dialogue: "Chloe: Lady, I just saved your life.", durationSeconds: 3,
    shotSize: "close-up", cameraAngle: "eye level", cameraMove: "static", composition: "", lens: "85mm",
    aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
    characters: ["Flora", "Chloe"], setting: "Underground Loading Dock", references: "",
  },
  {
    id: "s3", title: "Rack2", description: "Flora points.", action: "Flora points, hands shaking.",
    dialogue: "Chloe: Well, if you'd rather go breathe", durationSeconds: 2,
    shotSize: "close-up", cameraAngle: "over shoulder", cameraMove: "static", composition: "", lens: "85mm",
    aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
    characters: ["Flora", "Chloe"], setting: "Underground Loading Dock", references: "",
  },
  {
    id: "s4", title: "Rack3", description: "Flora points.", action: "Flora points, hands shaking.",
    dialogue: "with that pile of rot, I'm happy to toss you outside.", durationSeconds: 2,
    shotSize: "close-up", cameraAngle: "eye level", cameraMove: "static", composition: "", lens: "85mm",
    aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
    characters: ["Flora", "Chloe"], setting: "Underground Loading Dock", references: "",
  },
] as any[];

const regeneratePromptForClip = (clip: any, shots: any[]) => workflowsTestInternals.regenerateWorkflowClipSeedancePrompt(
  { name: "test", aspectRatio: "16:9", settings: {} },
  { assets: { characters: [], scenes: [], props: [] } } as any,
  clip,
  shots,
).seedancePrompt;

test("shot-order beats carry dialogue separately and leave no dialogue/reaction label", () => {
  const beats = internals.buildShotOrderVideoBeats(sampleShots);
  const formatted = internals.formatStoryboardVideoBeats(beats).lines;
  assert.equal(formatted.length, 4);
  assert.doesNotMatch(formatted.join("\n"), /dialogue\/reaction/i);
  assert.doesNotMatch(formatted.join("\n"), /;\s*dialogue\s*;\s*reaction/i);
  assert.match(formatted[0], /^S1: Exact dialogue: Flora: “Murder! Cold-blooded murder!”/);
});

test("fragmented dialogue merges into the beat where the sentence starts", () => {
  const beats = internals.buildShotOrderVideoBeats(sampleShots);
  assert.match(beats[2].dialogue ?? "", /Chloe: Well, if you'd rather go breathe with that pile of rot, I'm happy to toss you outside\./);
  assert.equal(beats[3].dialogue ?? "", "");
});

test("source-locked comma-ended dialogue is not merged with the next spoken turn", () => {
  const shots = [
    {
      id: "s1",
      title: "Buffet",
      description: "Chloe clutches her neck.",
      action: "Chloe rasps, holding her neck.",
      dialogue: "Chloe: Having an all-you-can-eat buffet,",
      durationSeconds: 1,
      characters: ["Chloe"],
      setting: "Freezer Altar",
      references: "",
      visualPrompt: "",
    },
    {
      id: "s2",
      title: "Explanation",
      description: "Chloe explains the fungus behavior.",
      action: "Chloe speaks while recovering her breath.",
      dialogue: "Chloe: With Flora's control gone, the fungus's base instinct took over: consume any available nutrients. And right now, she’s the biggest protein shake in the room.",
      durationSeconds: 3,
      characters: ["Chloe"],
      setting: "Freezer Altar",
      references: "",
      visualPrompt: "",
    },
  ] as any[];

  const normalized = internals.normalizeFragmentedStoryboardDialogue(shots, [
    "Having an all-you-can-eat buffet,",
    "With Flora's control gone, the fungus's base instinct took over: consume any available nutrients. And right now, she’s the biggest protein shake in the room.",
  ]);

  assert.equal(normalized[0].dialogue, "Chloe: Having an all-you-can-eat buffet,");
  assert.match(normalized[1].dialogue, /^Chloe: With Flora's control gone/);
});

test("repeated adjacent action text is not repeated in formatted beats", () => {
  const beats = internals.buildShotOrderVideoBeats(sampleShots);
  const formatted = internals.formatStoryboardVideoBeats(beats).lines;
  const repeats = formatted.filter((line: string) => /Flora points, hands shaking\./.test(line));
  assert.equal(repeats.length, 1);
  assert.match(formatted.join("\n"), /Rack2|Rack3|Flora points/i);
});

test("formatted shot beats replace repeated no-dialogue action with distinct reaction motion", () => {
  const formatted = internals.formatStoryboardVideoBeats([
    { label: "S1", camera: "medium, eye-level, 50mm", action: "Chloe fires.", text: "camera medium; Chloe fires.", dialogue: "" },
    { label: "S2", camera: "close-up, eye-level, 85mm", action: "Chloe fires.", sourceVisualPrompt: "Zombie head bursts in the shutter gap, smoke rolls around Chloe's shotgun.", text: "camera close-up; Chloe fires.", dialogue: "" },
  ] as any[]).lines;

  assert.equal(formatted.length, 2);
  assert.match(formatted[1], /Zombie head bursts in the shutter gap/);
  assert.doesNotMatch(formatted[1], /Chloe fires\./);
});

test("composition labels are not extracted as exact dialogue", () => {
  const formatted = internals.formatStoryboardVideoBeats([
    {
      label: "S1",
      text: 'Composition: "Chloe stands center-left, Leo center, Bob center-right inside the meditation circle, all facing the elevated pallet altar"; Action: the trio waits under tense light.',
    },
  ] as any[]).lines;

  assert.doesNotMatch(formatted.join("\n"), /Exact dialogue:\s*Composition/i);
  assert.match(formatted.join("\n"), /Chloe stands center-left/);
});

test("clip video beats preserve exact dialogue and avoid repeated setup action spam", () => {
  const repeatedAction = "Chloe steps forward despite bound hands, glaring up at Flora.";
  const shots = [
    {
      id: "s1", title: "Chloe interrupts", description: "Chloe cannot keep quiet.", action: repeatedAction,
      dialogue: "Chloe: Hey! The kid's just delivering food", durationSeconds: 2,
      shotSize: "medium", cameraAngle: "over-shoulder", cameraMove: "static hold",
      composition: "Chloe foreground left, Leo behind with pizza box, Flora elevated ahead", lens: "50mm",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Chloe", "Leo", "Flora"], setting: "Sanctuary Superstore Center", references: "Chloe foreground left, Leo behind with pizza box.",
    },
    {
      id: "s2", title: "Chloe interrupts reaction", description: "Flora hears the interruption.", action: repeatedAction,
      dialogue: "Chloe: and you're calling that a capital crime?", durationSeconds: 2,
      shotSize: "close-up", cameraAngle: "eye-level", cameraMove: "static hold",
      composition: "Flora foreground right facing Chloe screen-left", lens: "85mm",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Chloe", "Flora"], setting: "Sanctuary Superstore Center", references: "Flora reacts from the altar.",
    },
    {
      id: "s3", title: "Chloe holds", description: "Chloe continues talking.", action: repeatedAction,
      dialogue: "", durationSeconds: 2,
      shotSize: "close-up", cameraAngle: "eye-level", cameraMove: "static hold",
      composition: "Chloe screen-left with bound hands visible", lens: "85mm",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Chloe"], setting: "Sanctuary Superstore Center", references: "Chloe bound hands visible.",
    },
  ] as any[];
  const formatted = internals.formatStoryboardVideoBeats(internals.buildShotOrderVideoBeats(shots)).lines;
  const joined = formatted.join("\n");

  assert.match(joined, /Exact dialogue: Chloe: “Hey! The kid's just delivering food/);
  assert.match(joined, /and you're calling that a capital crime\?/);
  assert.equal((joined.match(new RegExp(repeatedAction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 1);
  assert.match(formatted[1], /Flora foreground right facing Chloe screen-left|Flora reacts from the altar/i);
  assert.match(formatted[2], /Chloe screen-left with bound hands visible/i);
});

test("composeSeedancePrompt with S beats omits storyboard-image and P-beat instructions", () => {
  const beats = internals.buildShotOrderVideoBeats(sampleShots);
  const prompt = internals.composeSeedancePrompt({
    estimatedDuration: 10, aspectRatio: "9:16", visualStyle: "dark comedy",
    characterIdentities: {}, setting: "Underground Loading Dock",
    characters: ["Chloe", "Flora"], plotGoal: "Chloe blasts the zombie.",
    startState: "Chloe fires", endState: "Chloe racks the shotgun",
    actions: [], dialogue: [], storyboardBeats: beats,
    layoutMemory: "", storyboardControlLevel: "hard", storyboardType: "multi_panel",
    directorFreedom: "",
  } as any);
  assert.doesNotMatch(prompt, /storyboard image/i);
  assert.doesNotMatch(prompt, /animate P1 first/i);
  assert.match(prompt, /Do not skip, merge, or reorder the shot beats; play S1 first, then S2/);
  assert.match(prompt, /Shot beats, follow in this exact order:/);
  assert.match(prompt, /S1: .*Shot: .*medium shot.*eye level.*handheld.*50mm/i);
  assert.match(prompt, /S2: .*Shot: .*close-up.*eye level.*static.*85mm/i);
});

test("composeSeedancePrompt puts initial character state and positions in the header only", () => {
  const beats = internals.buildShotOrderVideoBeats([
    {
      id: "s1",
      title: "After shot",
      description: "Chloe and Flora hold their positions after the gunshot.",
      action: "Chloe watches Flora after firing while Flora starts to scold her.",
      dialogue: "",
      durationSeconds: 2,
      shotSize: "medium shot",
      cameraAngle: "eye level",
      cameraMove: "static",
      composition: "Chloe screen-left, facing screen-right, holding shotgun lowered; Flora screen-right, facing Chloe, robe splattered",
      lens: "50mm",
      aperture: "",
      shutter: "",
      iso: "",
      sound: "",
      music: "",
      subtitle: "",
      characters: ["Chloe", "Flora"],
      setting: "Underground Loading Dock",
      references: "Chloe screen-left with shotgun lowered; Flora screen-right in splattered robe.",
    },
  ] as any[]);
  const prompt = internals.composeSeedancePrompt({
    estimatedDuration: 8,
    aspectRatio: "16:9",
    visualStyle: "dark comedy",
    characterIdentities: {},
    setting: "Underground Loading Dock",
    characters: ["Chloe", "Flora"],
    plotGoal: "Flora reacts after Chloe fires.",
    startState: "Chloe screen-left with shotgun lowered; Flora screen-right, robe splattered.",
    endState: "Flora continues scolding Chloe.",
    actions: [],
    dialogue: [],
    storyboardBeats: beats,
    layoutMemory: "",
    storyboardControlLevel: "hard",
    storyboardType: "multi_panel",
    directorFreedom: "",
  } as any);

  const initialIndex = prompt.indexOf("Initial character state and positions:");
  const shotBeatIndex = prompt.indexOf("Shot beats, follow in this exact order:");
  assert.ok(initialIndex > -1, "expected initial state header");
  assert.ok(shotBeatIndex > -1, "expected shot beat header");
  assert.ok(initialIndex < shotBeatIndex, "initial state should appear before S beats");
  assert.match(prompt, /Initial character state and positions: .*Chloe.*screen-left.*Flora.*screen-right/i);
  const beatBlock = prompt.slice(shotBeatIndex);
  assert.equal((beatBlock.match(/Initial character state and positions/g) ?? []).length, 0);
});

test("composeSeedancePrompt carries detailed bed restraint state into initial header", () => {
  const beats = internals.buildShotOrderVideoBeats([
    {
      id: "s1",
      title: "Chloe escalates",
      description: "Flora's tenderness cracks slightly under Chloe's insult.",
      action: "Chloe tilts her head defiantly toward Flora.",
      dialogue: "Chloe: Were you dropped on your head as a baby?",
      durationSeconds: 2,
      shotSize: "close-up",
      cameraAngle: "eye-level",
      cameraMove: "static hold",
      composition: "Defiant Chloe on altar, Flora icy reaction, fast comic timing.",
      lens: "85mm",
      aperture: "",
      shutter: "",
      iso: "",
      sound: "",
      music: "",
      subtitle: "",
      characters: ["Chloe", "Flora"],
      setting: "Living Vine Hospital Bed",
      references: "Keep both linked image references consistent.",
    },
  ] as any[]);
  const prompt = internals.composeSeedancePrompt({
    estimatedDuration: 10,
    aspectRatio: "16:9",
    visualStyle: "dark comedy",
    characterIdentities: {},
    setting: "Living Vine Hospital Bed",
    characters: ["Chloe", "Flora"],
    plotGoal: "Chloe insults Flora while restrained.",
    startState: "Starts with in Living Vine Hospital Bed Chloe lies bound center, restrained by living vines/root restraints; Flora stands at the head facing her.; Location: Living Vine Hospital Bed Characters: Chloe, Flora Start: Starts with in Living Vine Hospital Bed Chloe lies bound center; Flora stands at the head facing her. End: Ends with in Living Vine Hospital Bed Chloe glares up; Flora remains poised at screen top. Continuity references: Use Chloe and Flora linked image references; Chloe restrained by living vines. | Chloe bound center, wrist connected to needle/tubing; Flora at head holding tubing and needle.",
    endState: "Flora remains at the head of the Living Vine Hospital Bed.",
    actions: [],
    dialogue: [],
    storyboardBeats: beats,
    layoutMemory: "Location: Living Vine Hospital Bed\nCharacters: Chloe, Flora\nStart: Starts with in Living Vine Hospital Bed Chloe lies bound center; Flora stands at the head facing her.\nContinuity references: Chloe is still lying on the Living Vine Hospital Bed with root restraints and living vines holding her down; Chloe wrist connected to needle/tubing.",
    storyboardControlLevel: "hard",
    storyboardType: "multi_panel",
    directorFreedom: "",
  } as any);

  const initialLine = prompt.split("\n").find((line) => line.startsWith("Initial character state and positions:")) ?? "";
  assert.match(initialLine, /Chloe/i);
  assert.match(initialLine, /Living Vine Hospital Bed/i);
  assert.match(initialLine, /restrained by living vines\/root restraints/i);
  assert.match(initialLine, /Chloe.*wrist connected to needle\/tubing/i);
  assert.match(initialLine, /Flora.*head.*facing/i);
  assert.doesNotMatch(initialLine, /Flora.*restrained by living vines\/root restraints/i);
  assert.doesNotMatch(initialLine, /hands bound with rope/i);
  assert.doesNotMatch(initialLine, /\bStart\s*:/i);
  assert.doesNotMatch(initialLine, /\bCharacters\s*:/i);
  assert.doesNotMatch(initialLine, /Chloe Flora/i);
  assert.doesNotMatch(initialLine, /'s tenderness/i);
  assert.ok((initialLine.match(/Living Vine Hospital Bed/g) ?? []).length <= 2, initialLine);
  assert.doesNotMatch(initialLine, /^Initial character state and positions: Chloe tilts her head/i);
});

test("composeSeedancePrompt keeps living-vine restraint scoped to the bound character", () => {
  const beats = internals.buildShotOrderVideoBeats([
    {
      id: "s1",
      title: "Altar reveal",
      description: "A freezer-like altar chamber pulses under sour green light.",
      action: "Chloe lies bound center; Flora stands at the head facing her.",
      dialogue: "",
      durationSeconds: 2,
      shotSize: "wide",
      cameraAngle: "eye-level",
      cameraMove: "slow push-in",
      composition: "Set in Living Vine Hospital Bed; frame only the visible subject(s) for this shot.",
      lens: "24mm",
      characters: ["Chloe", "Flora"],
      setting: "Living Vine Hospital Bed",
      references: "Use Chloe and Flora linked image references; Chloe restrained by living vines.",
      visualPrompt: "3D dark comedy cartoon, altar chamber, Chloe restrained, Flora looming.",
    },
    {
      id: "s2",
      title: "Flora lectures",
      description: "Flora raises the bone needle and smiles down coldly.",
      action: "Flora steadies the tubing with one hand, facing Chloe.",
      dialogue: "Flora: Stop struggling, darling.",
      durationSeconds: 2,
      shotSize: "medium",
      cameraAngle: "eye-level",
      cameraMove: "static hold",
      composition: "Set in Living Vine Hospital Bed; frame only the visible subject(s) for this shot.",
      lens: "50mm",
      characters: ["Chloe", "Flora"],
      setting: "Living Vine Hospital Bed",
      references: "Flora holds Massive Bone Needle connected to Clear Plastic Tubing.",
      visualPrompt: "Flora with bone needle, Chloe bound below, cinematic green light.",
    },
  ] as any[]);
  const prompt = internals.composeSeedancePrompt({
    estimatedDuration: 8,
    aspectRatio: "16:9",
    visualStyle: "dark comedy",
    characterIdentities: {},
    setting: "Living Vine Hospital Bed",
    characters: ["Chloe", "Flora"],
    plotGoal: "Flora prepares Chloe on the vine bed.",
    startState: "Starts with in Living Vine Hospital Bed Chloe lies bound center; Flora stands at the head facing her.",
    endState: "Ends with in Living Vine Hospital Bed Chloe glares up; Flora remains poised at screen top.",
    actions: [],
    dialogue: [],
    storyboardBeats: beats,
    layoutMemory: "Chloe restrained by living vines. Flora holds Massive Bone Needle connected to Clear Plastic Tubing.",
    storyboardControlLevel: "hard",
    storyboardType: "multi_panel",
    directorFreedom: "",
  } as any);

  const initialLine = prompt.split("\n").find((line) => line.startsWith("Initial character state and positions:")) ?? "";
  assert.match(initialLine, /Chloe.*Living Vine Hospital Bed.*restrained by living vines\/root restraints/i);
  assert.match(initialLine, /Flora.*head.*facing/i);
  assert.match(initialLine, /Flora.*Massive Bone Needle/i);
  assert.doesNotMatch(initialLine, /Flora.*restrained by living vines\/root restraints/i);
  assert.doesNotMatch(prompt, /State: Flora .*restrained by living vines\/root restraints/i);
  assert.doesNotMatch(prompt, /hands bound with rope/i);
});

test("composeSeedancePrompt with P beats keeps storyboard instructions", () => {
  const prompt = internals.composeSeedancePrompt({
    estimatedDuration: 10, aspectRatio: "16:9", visualStyle: "dark comedy",
    characterIdentities: {}, setting: "dock", characters: ["Chloe"], plotGoal: "goal",
    startState: "", endState: "", actions: [], dialogue: [],
    storyboardBeats: [{ label: "P1", text: "Chloe fires." }, { label: "P2", text: "Flora reacts." }],
    layoutMemory: "", storyboardControlLevel: "hard", storyboardType: "multi_panel",
    directorFreedom: "",
  } as any);
  assert.match(prompt, /Use the connected storyboard image as the main visual reference/);
  assert.match(prompt, /animate P1 first, then P2/);
});

test("composeSeedancePrompt clamps tiny estimated duration to Seedance minimum", () => {
  const prompt = internals.composeSeedancePrompt({
    estimatedDuration: 2,
    targetDuration: 4,
    aspectRatio: "16:9",
    visualStyle: "dark comedy",
    characterIdentities: {},
    setting: "Ruined City Ring Road",
    characters: ["Chloe", "Bob", "Leo"],
    plotGoal: "The motorcycle crosses the ruined ring road.",
    startState: "",
    endState: "",
    actions: ["摩托在废弃车辆间高速穿梭。"],
    dialogue: [],
    storyboardBeats: [{ label: "S1", text: "摩托在废弃车辆间高速穿梭。" }],
    layoutMemory: "",
    storyboardControlLevel: "medium",
    storyboardType: "multi_panel",
    directorFreedom: "",
  } as any);

  assert.match(prompt, /Generate one continuous 4s cinematic video/);
  assert.doesNotMatch(prompt, /Generate one continuous 2s cinematic video/);
});

test("regenerated Seedance prompt includes Scene Visual Lock for Pallet Altar shots", () => {
  const sceneVisualLock = [
    "Scene visual authority: Sanctuary Superstore Center.",
    "Current zone: Pallet Altar, inside the same canonical scene.",
    "Do not change time of day, color palette, building type, material language, lighting family, or fixed landmarks.",
    "Maintain: Interior dim; muted green; abandoned big-box superstore; supermarket shelves, shopping carts, concrete floor, green fabric strips.",
  ].join(" ");
  const prompt = regeneratePromptForClip(
    {
      id: "clip-001",
      title: "Clip 01 · Pallet Altar",
      setting: "Pallet Altar",
      characters: ["Flora", "Chloe"],
      storyboardControlLevel: "hard",
      storyboardType: "multi_panel",
    },
    [{
      id: "shot-001",
      title: "Pallet Altar Judgment",
      description: "Flora judges Chloe from the wooden pallet altar.",
      action: "Flora points down from the wooden pallet altar while Chloe stands below.",
      dialogue: "Flora: You have brought rot into our sanctuary!",
      durationSeconds: 3,
      shotSize: "medium shot",
      cameraAngle: "low angle",
      cameraMove: "slow push-in",
      composition: "Flora elevated on the pallet altar, Chloe below, green fabric strips behind them",
      lens: "50mm",
      aperture: "",
      shutter: "",
      iso: "",
      sound: "",
      music: "",
      subtitle: "",
      characters: ["Flora", "Chloe"],
      setting: "Pallet Altar",
      references: "green fabric strips, supermarket shelves, pallet altar",
      canonicalSceneId: "scene-1-sanctuary-superstore-center",
      sceneZone: "Pallet Altar",
      sceneAnchors: ["Pallet Altar", "green fabric strips"],
      sceneVisualLock,
      visualPrompt: "Wooden pallet altar inside the same abandoned big-box superstore sanctuary.",
    } as any],
  );

  assert.match(prompt, /Scene visual continuity lock:/);
  assert.match(prompt, /Scene visual authority: Sanctuary Superstore Center/);
  assert.match(prompt, /Current zone: Pallet Altar/);
  assert.match(prompt, /Do not change time of day, color palette, building type/i);
  assert.match(prompt, /material language, lighting family, or fixed landmarks/i);
  assert.match(prompt, /abandoned big-box superstore/);
  assert.match(prompt, /Shot beats, follow in this exact order:/);
  assert.match(prompt, /^S1:/m);
});

test("regenerated Seedance prompt follows explicit late-clip scene transition instead of stale clip setting", () => {
  const prompt = internals.regenerateWorkflowClipSeedancePrompt(
    { name: "test", aspectRatio: "9:16", settings: {} },
    { assets: { characters: [], scenes: [], props: [] } } as any,
    { id: "clip-004", title: "Clip 04", setting: "Freezer Altar" } as any,
    [
      {
        id: "s1",
        title: "Cultists stare",
        description: "Cultists turn toward Flora.",
        action: "Cultists lock their gaze onto Flora.",
        dialogue: "",
        durationSeconds: 2,
        characters: ["Flora"],
        setting: "Freezer Altar",
        sceneVisualLock: "Scene visual authority: Frozen Meat Section. Current zone: Freezer Altar.",
      },
      {
        id: "s2",
        title: "Dragged to wall",
        description: "Vines drag Flora toward the fungus-covered drywall.",
        action: "Vines drag Flora toward the fungus-covered drywall.",
        dialogue: "Flora: Help me!",
        durationSeconds: 2,
        characters: ["Flora"],
        setting: "Fungus-Covered Drywall",
        sceneVisualLock: "Scene visual authority: Frozen Meat Section. Current zone: Fungus-Covered Drywall.",
      },
    ] as any[],
  ).seedancePrompt;

  assert.match(prompt, /Scene: Fungus-Covered Drywall/);
  assert.match(prompt, /Current zone: Fungus-Covered Drywall/);
});

test("formatStoryboardVideoBeats keeps every beat line when dedupe would empty it", () => {
  const beats = [
    { label: "S1", camera: "", action: "Flora points, hands shaking.", text: "Flora points, hands shaking." },
    { label: "S2", camera: "", action: "Flora points, hands shaking.", text: "Flora points, hands shaking." },
    { label: "S3", camera: "", action: "Flora points, hands shaking.", text: "Flora points, hands shaking." },
  ] as any[];
  const formatted = internals.formatStoryboardVideoBeats(beats).lines;
  assert.equal(formatted.length, 3);
  assert.match(formatted[0], /^S1:/);
  assert.match(formatted[1], /^S2:/);
  assert.match(formatted[2], /^S3:/);
});

test("final video prompt hoists repeated S beat boilerplate before compaction", () => {
  const prompt = [
    "Clip video prompt for Clip 12.",
    "S1: Shot: close-up; blocking: Cafeteria listens to Flora PA announcement, trio tense in corner, cultists rigid. Same setting and character blocking, natural reaction or angle change.; Exact dialogue: Flora: \"Line one.\"",
    "S2: Shot: close-up; blocking: Cafeteria listens to Flora PA announcement, trio tense in corner, cultists rigid. Same setting and character blocking, natural reaction or angle change.; Show the listener's reaction, speaker's expression, and body language as the line lands.; Chloe reacts.",
    "S3: Shot: close-up; blocking: Cafeteria listens to Flora PA announcement, trio tense in corner, cultists rigid. Same setting and character blocking, natural reaction or angle change.; Bob reacts.",
  ].join("\n");

  const result = internals.finalizeWorkflowVideoPrompt(prompt);

  assert.match(result, /Clip blocking: Cafeteria listens to Flora PA announcement, trio tense in corner, cultists rigid\./);
  assert.equal((result.match(/Same setting and character blocking/g) ?? []).length, 0);
  assert.equal((result.match(/Show the listener/g) ?? []).length, 0);
});

test("formatted S beats drop repeated generic performance and reaction boilerplate", () => {
  const formatted = internals.formatStoryboardVideoBeats([
    {
      label: "S1",
      camera: "close-up; eye-level; static hold; 85mm",
      action: "All attention narrows from the stage to Chloe in the front row. Hold the same scene geography and shift to a natural reaction or angle change.",
      dialogue: "Flora: You are the perfect beating core for our Sanctuary.",
      performance: "Performance: Flora shows heightened ritual seriousness with theatrical conviction; delivery ceremonial and performative, as if addressing the room",
      visibleCharacters: ["Flora", "Chloe"],
    },
    {
      label: "S2",
      camera: "close-up; eye-level; static hold; 85mm",
      action: "All attention narrows from the stage to Chloe in the front row. Show the listener's reaction, speaker's expression, and body language as the line lands.",
      dialogue: "",
      performance: "Performance: Flora and Chloe show heightened ritual seriousness with theatrical conviction",
      visibleCharacters: ["Flora", "Chloe"],
    },
    {
      label: "S3",
      camera: "close-up; over-shoulder; static hold; 85mm",
      action: "reaction/cutaway detail, same scene geography, same character positions; All attention narrows from the stage to Chloe in the front row.",
      dialogue: "",
      performance: "Performance: Flora shows heightened ritual seriousness with theatrical conviction; delivery ceremonial and performative, as if addressing the room",
      visibleCharacters: ["Flora", "Chloe"],
    },
  ] as any[]).lines;
  const joined = formatted.join("\n");

  assert.match(formatted[0], /Exact dialogue: Flora: “You are the perfect beating core for our Sanctuary\.”/);
  assert.equal((joined.match(/Performance:/g) ?? []).length, 0);
  assert.doesNotMatch(joined, /Show the listener|Hold the same scene geography|reaction\/cutaway detail/i);
});

test("repeated S beat fallback uses concrete shot context instead of generic previous-action wording", () => {
  const formatted = internals.formatStoryboardVideoBeats([
    {
      label: "S1",
      camera: "close-up; eye-level; static hold; 85mm",
      action: "All attention narrows from the stage to Chloe in the front row.",
      sourceVisualPrompt: "Flora points her gaze at Chloe, Chloe stiffens, Bob and Leo flank her.",
      dialogue: "Flora: Your soul is exactly the primal engine.",
      visibleCharacters: ["Flora", "Chloe"],
    },
    {
      label: "S2",
      camera: "close-up; over-shoulder; static hold; 85mm",
      action: "All attention narrows from the stage to Chloe in the front row.",
      sourceVisualPrompt: "Chloe locks her shoulders, Bob glances sideways, Leo freezes behind the pizza box.",
      dialogue: "",
      visibleCharacters: ["Flora", "Chloe"],
    },
  ] as any[]).lines;

  assert.match(formatted[1], /Chloe locks her shoulders/);
  assert.doesNotMatch(formatted[1], /previous action|reaction angle|consequence|without repeating/i);
});

test("compact S beat keeps concrete action before long blocking", () => {
  const compacted = internals.compactWorkflowVideoPromptLine(
    [
      "S2: Shot: close-up; eye-level; static hold; 85mm;",
      "blocking: Chloe foreground left facing screen-right, Flora blurred high in the background, Bob and Leo at frame edges, cultist rows behind them, stage lights above them, aisle walls around them;",
      "Chloe's shoulders tighten; she keeps her chin raised while her eyes flick toward the blocked aisles.",
      "Performance: Chloe shows tense, alert expression with small anxious micro-reactions.",
    ].join(" "),
  );

  assert.match(compacted, /Chloe's shoulders tighten/);
  assert.match(compacted, /Shot: close-up; eye-level; static hold; 85mm/);
});

test("compact S beat with dialogue keeps dialogue instead of emitting half-word fragments", () => {
  const compacted = internals.compactWorkflowVideoPromptLine(
    [
      "S7: Shot: close-up; over-shoulder; static hold; 85mm;",
      "Exact dialogue: Flora: Let us rejoice for our brothers and sisters who made the soil holy tonight.;",
      "Performance: Flora shows heightened ritual seriousness with theatrical conviction; delivery ceremonial and performative, as if addressing the room;",
      "All attention narrows from the stage to Chloe in the front row. Hold the same scene geography and shift to a natural reaction or angle change.",
      "The camera keeps foreground midground and background separated while preserving every spatial anchor across the ritual hall.".repeat(8),
    ].join(" "),
  );

  assert.match(compacted, /Exact dialogue: Flora: “Let us rejoice for our brothers and sisters who made the soil holy tonight\.”/);
  assert.doesNotMatch(compacted, /addre\.|del\.|Cultists s|Cultists sit r|as if\s*$/i);
});

test("long S-mode prompt keeps order instruction, beat numbering, and no empty dialogue residue", () => {
  const beatCount = 9;
  const storyboardBeats = Array.from({ length: beatCount }, (_, index) => {
    const i = index + 1;
    const action =
      `Chloe sprints across the neon-lit loading dock segment ${i}, vaulting over stacked crates while zombie hands burst through the rattling shutters behind her, sparks raining down onto the wet concrete floor.`;
    const dialogue = i % 2 === 1 ? "Flora: Murder! Cold-blooded murder!" : "";
    return {
      label: `S${i}`,
      camera: "medium shot, eye level, handheld, 50mm",
      action,
      text: `camera medium shot, eye level, handheld, 50mm; ${action}`,
      dialogue,
    };
  });

  const prompt = internals.composeSeedancePrompt({
    estimatedDuration: 15,
    aspectRatio: "9:16",
    visualStyle: "saturated 3D American animated dark-comedy with cinematic lighting and exaggerated fast reactions. ".repeat(18),
    characterIdentities: {},
    setting: `Underground loading dock filled with flickering fluorescent tubes, dripping pipes, stacked pallets and a half-open cargo shutter. ${"Glossy machinery, purple emergency strobes, taped-off forklift lanes, scattered tools and continuity geography everywhere. ".repeat(8)}`,
    characters: ["Chloe", "Flora"],
    plotGoal: "Chloe fights through the loading dock to seal the shutter before the horde breaks in.",
    startState: "Chloe stands at the dock entrance, shotgun raised",
    endState: "Chloe racks the shotgun beside the sealed shutter",
    actions: [],
    dialogue: [],
    storyboardBeats,
    layoutMemory: "",
    storyboardControlLevel: "hard",
    storyboardType: "multi_panel",
    directorFreedom: "",
  } as any);

  assert.match(prompt, /No subtitles, UI, watermarks, random text, gore, or identity drift\./);
  assert.ok(prompt.length <= 3900, `expected <= 3900 chars, got ${prompt.length}`);

  // 1) S 模式顺序语义保留，不被替换成 P 节拍指令
  assert.match(prompt, /shot beats/i);
  assert.doesNotMatch(prompt, /P beats|animate P1|Follow P beats/i);

  // 2) 无空台词残留
  assert.doesNotMatch(prompt, /\bdialogue\s*;/);

  // 3) S1..Sn 节拍行连号无断档
  const beatLabels = prompt
    .split("\n")
    .map((line) => line.match(/^S(\d+):/)?.[1])
    .filter(Boolean)
    .map(Number);
  assert.equal(beatLabels.length, beatCount);
  assert.deepEqual(beatLabels, Array.from({ length: beatCount }, (_, index) => index + 1));
});

test("long 12-beat S-mode prompt keeps every S label in the editable prompt", () => {
  const beatCount = 12;
  const storyboardBeats = Array.from({ length: beatCount }, (_, index) => {
    const i = index + 1;
    const action =
      `Chloe crosses continuity zone ${i}, keeps the silver flare in her left hand, the cracked helmet strap on her shoulder, and the lab cart exactly beside the yellow floor arrow while smoke and purple alarm light wrap around the group. ${"Camera tracks every prop and blocking marker without changing identities. ".repeat(5)}`;
    return {
      label: `S${i}`,
      camera: "medium shot, eye level, slow tracking, 50mm",
      action,
      text: `camera medium shot, eye level, slow tracking, 50mm; ${action}`,
      dialogue: i === 4 ? "Chloe: Hold the line exactly where it is!" : "",
    };
  });

  const prompt = internals.composeSeedancePrompt({
    estimatedDuration: 15,
    aspectRatio: "9:16",
    visualStyle: "premium saturated 3D American animated sitcom horror comedy with glossy cinematic lighting, fast expressive timing, readable silhouettes, continuity-safe staging, precise prop carryover, and strong facial acting. ".repeat(24),
    characterIdentities: {},
    setting: `Laser-filled cosmetic lab with mirrored walls, acrylic beauty machinery, tiled floor arrows, emergency shutters, glowing serum cabinets, and a broken poster wall. ${"Keep every doorway, cart, cable bundle, and light panel in stable screen geography across the clip. ".repeat(14)}`,
    sceneVisualLock: `Scene visual continuity lock: exact same cosmetic lab layout, same laser emitters, same poster wall, same floor arrows, same emergency shutter, same glossy carts, same serum cabinet, same smoke direction, same character scale, same left-right geography, no redesigned architecture. ${"Preserve all spatial anchors, lighting anchors, color anchors, damaged surfaces, and prop positions between beats. ".repeat(18)}`,
    characters: ["Chloe", "Flora", "Tiffany", "Eugene"],
    plotGoal: "The team crosses the lab without breaking the continuity layout while Chloe keeps control of the flare and blocks the laser trap.",
    startState: "Chloe stands beside the serum cabinet with the flare in her left hand",
    endState: "Chloe reaches the shutter with the flare still in her left hand",
    actions: [],
    dialogue: [],
    storyboardBeats,
    layoutMemory: "",
    storyboardControlLevel: "hard",
    storyboardType: "multi_panel",
    directorFreedom: "",
  } as any);

  assert.ok(prompt.length <= 9000, `expected <= 9000 chars, got ${prompt.length}`);
  assert.match(prompt, /Scene visual continuity lock:/);
  assert.match(prompt, /Chloe: “Hold the line exactly where it is!”/);

  const beatLabels = prompt
    .split("\n")
    .map((line) => line.match(/^(S\d+):/)?.[1])
    .filter(Boolean);
  assert.deepEqual(beatLabels, Array.from({ length: beatCount }, (_, index) => `S${index + 1}`));
});

test("long exact dialogue is never truncated during video prompt finalization", () => {
  const longDialogue =
    "However, I would like to establish a verbal liability waiver: If, during the course of the broadcast, my occupational reflexes cause me to bludgeon your zombies into a fine puree and consequently get your stream Terms-of-Service banned, I am not legally responsible.";
  const prompt = [
    "Generate one continuous 15s cinematic video, 16:9.",
    `Style: ${"saturated 3D American animated dark-comedy, cinematic lighting. ".repeat(80)}`,
    `Scene: livestream plaza. ${"ring lights, drones, neon broadcast clutter. ".repeat(80)}`,
    "Characters: Leo = use connected character reference image; Pineapple Showrunner = use connected character reference image.",
    "Shot beats, follow in this exact order:",
    `S1: Shot: close-up; eye-level; handheld tracking; 85mm; Exact dialogue: Leo: ${longDialogue}; Leo raises pineapple pizza slices like legal evidence while Chloe and Bob react.`,
    "S2: Shot: close-up; low angle; handheld tracking; 85mm; Exact dialogue: Pineapple Showrunner: Deal!; The showrunner punches the air.",
  ].join("\n");

  const result = internals.finalizeWorkflowVideoPrompt(prompt);

  assert.match(result, new RegExp(escapeRegExp(`Leo: “${longDialogue}”`)));
  assert.doesNotMatch(result, /\bliability waiver: If, during the course of the broadcast,[^”\n]*$/);
  assert.doesNotMatch(result, /\baddre\.|Cultists s|ding, or leaves|t the system/i);
});

test("compactWorkflowVideoPromptLine keeps shot-beat wording for S-mode order line", () => {
  const sLine = "Do not skip, merge, or reorder the shot beats; play S1 first, then S2, continuing in order.";
  const compactedS = internals.compactWorkflowVideoPromptLine(sLine);
  assert.doesNotMatch(compactedS, /P beats|animate P1|Follow P beats/i);
  assert.match(compactedS, /shot beats/i);
  const pLine = "Do not skip, merge, or reorder the P beats; animate P1 first, then P2, then P3, continuing through the listed storyboard panels.";
  const compactedP = internals.compactWorkflowVideoPromptLine(pLine);
  assert.match(compactedP, /Follow P beats in exact order/);
});

test("clampShotDuration clamps to 1-3 seconds with default 2", () => {
  assert.equal(internals.clampShotDuration(Number.NaN), 2);
  assert.equal(internals.clampShotDuration(0), 1);
  assert.equal(internals.clampShotDuration(2), 2);
  assert.equal(internals.clampShotDuration(5), 3);
});

test("deriveWorkflowClipsFromShots keeps every clip within the 12-beat cap", () => {
  const shots = Array.from({ length: 15 }, (_, index) => ({
    id: `m${index + 1}`, title: `Beat ${index + 1}`, description: "Chloe runs.", action: "Chloe runs forward.",
    dialogue: "", durationSeconds: 1,
    shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
    aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
    characters: [], setting: "Underground Loading Dock", references: "",
  })) as any[];
  const clips = internals.deriveWorkflowClipsFromShots(shots);
  assert.ok(clips.length >= 2);
  for (const clip of clips) {
    assert.ok(clip.shotIds.length <= 12, `expected <= 12 shots per clip, got ${clip.shotIds.length}`);
  }
  assert.equal(clips.reduce((sum: number, clip: any) => sum + clip.shotIds.length, 0), 15);
});

test("deriveWorkflowClipsFromShots keeps fragmented dialogue in the starting clip", () => {
  const shots = [
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `setup-${index + 1}`,
      title: `Setup ${index + 1}`,
      description: "Chloe blocks the zombie.",
      action: "Chloe blocks the zombie.",
      dialogue: "",
      durationSeconds: 3,
      shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Chloe"], setting: "Underground Loading Dock", references: "",
    })),
    {
      id: "split-a",
      title: "Split A",
      description: "Flora points at the corpse.",
      action: "Flora points at the corpse.",
      dialogue: "Flora: Go breathe with that pile of rotten",
      durationSeconds: 3,
      shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Flora", "Chloe"], setting: "Underground Loading Dock", references: "",
    },
    {
      id: "split-b",
      title: "Split B",
      description: "Flora keeps pointing.",
      action: "Flora keeps pointing.",
      dialogue: "meat, I'm happy to toss you outside.",
      durationSeconds: 2,
      shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Flora", "Chloe"], setting: "Underground Loading Dock", references: "",
    },
  ] as any[];

  const clips = internals.deriveWorkflowClipsFromShots(shots);

  assert.equal(clips[0].shotIds.includes("split-a"), true);
  assert.equal(clips[0].shotIds.includes("split-b"), true);
  assert.equal(clips[0].seedancePrompt, "");
  assert.equal(clips[1]?.seedancePrompt ?? "", "");
  const generatedPrompt = regeneratePromptForClip(clips[0], shots.filter((shot) => clips[0].shotIds.includes(shot.id)));
  assert.match(
    generatedPrompt,
    /Flora: “Go breathe with that pile of rotten meat, I'm happy to toss you outside\.”/,
  );
});

test("deriveWorkflowClipsFromShots uses Chinese layout memory templates for Chinese source", () => {
  const shots = [
    {
      id: "cn-1",
      title: "逃出菌丝巢穴",
      description: "Chloe前方跑路，Bob和Leo跟出门口。",
      action: "Chloe前方跑路，Bob和Leo跟出门口。",
      dialogue: "",
      durationSeconds: 2,
      shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Chloe", "Bob", "Leo"],
      setting: "Fungal Shelter Exit",
      references: "摩托车停在阴暗地下室出口。",
    },
    {
      id: "cn-2",
      title: "发动摩托",
      description: "Bob猛拧门，摩托从阴暗地下室驶出。",
      action: "Bob猛拧门，摩托从阴暗地下室驶出。",
      dialogue: "",
      durationSeconds: 2,
      shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Chloe", "Bob", "Leo"],
      setting: "Fungal Shelter Exit",
      references: "",
    },
  ] as any[];
  const clips = internals.deriveWorkflowClipsFromShots(
    shots,
    internals.workflowClipContext(
      { name: "test", aspectRatio: "16:9", settings: {} },
      [{ name: "Chloe" }, { name: "Bob" }, { name: "Leo" }] as any,
      { characters: [{ name: "Chloe" }, { name: "Bob" }, { name: "Leo" }], props: [] },
      "克洛伊前方跑路，鲍勃和里奥跟出门口。鲍勃猛拧门，摩托从阴暗地下室驶出。菌丝巢穴出口不断震动，腐烂的墙面向内坍塌，三个人必须保持同一方向逃离。克洛伊在最前方回头催促，鲍勃负责打开出口，里奥紧跟在后面不要掉队。",
    ),
  );

  const memory = clips[0].layoutMemory;
  assert.match(memory, /位置：Fungal Shelter Exit/);
  assert.match(memory, /角色：Chloe, Bob, Leo/);
  assert.match(memory, /开始：开始于/);
  assert.match(memory, /结束：结束于/);
  assert.match(memory, /连续性参考：摩托车停在阴暗地下室出口。/);
  assert.match(memory, /保持屏幕方向/);
  assert.doesNotMatch(memory, /\b(?:Location|Characters|Start|End|Continuity references|Starts with|Ends with|Rule):?/);
});

test("deriveWorkflowClipsFromShots splits scene-event changes before positioning-board conflicts", () => {
  const shots = [
    {
      id: "cafeteria-1",
      title: "Flora ritual announcement",
      description: "Flora speaks in the cafeteria.",
      action: "Chloe and Bob listen from the cafeteria corner.",
      dialogue: "",
      durationSeconds: 2,
      shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Chloe", "Bob", "Flora"],
      setting: "Sanctuary Cafeteria",
      references: "",
      canonicalSceneId: "scene-sanctuary-superstore-center",
      sceneZone: "Sanctuary Cafeteria",
      visualPrompt: "",
    },
    {
      id: "freezer-1",
      title: "Frozen wall whisper",
      description: "The scene shifts to the freezer wall.",
      action: "Leo notices fungus spreading across the freezer wall.",
      dialogue: "",
      durationSeconds: 2,
      shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Leo"],
      setting: "Frozen Meat Section",
      references: "",
      canonicalSceneId: "scene-frozen-meat-section",
      sceneZone: "Frozen Meat Section",
      visualPrompt: "",
    },
  ] as any[];

  const clips = internals.deriveWorkflowClipsFromShots(shots);

  assert.equal(clips.length, 2);
  assert.deepEqual(clips[0].shotIds, ["cafeteria-1"]);
  assert.deepEqual(clips[1].shotIds, ["freezer-1"]);
});

test("deriveWorkflowClipsFromShots merges isolated short event clips into adjacent clips", () => {
  const shots = [
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `altar-${index + 1}`,
      title: `Altar beat ${index + 1}`,
      description: "The altar confrontation continues.",
      action: "Chloe and Flora hold the freezer altar confrontation.",
      dialogue: "",
      durationSeconds: index === 0 ? 3 : 2,
      shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Chloe", "Flora"],
      setting: "Freezer Altar",
      references: "",
      canonicalSceneId: "scene-freezer",
      sceneZone: "Freezer Altar",
      visualPrompt: "",
    })),
    {
      id: "hiss-1",
      title: "Collective Hiss",
      description: "The brewing vat hall hisses back.",
      action: "Cultists and environment react with a synchronized hiss.",
      dialogue: "",
      durationSeconds: 2,
      shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Cultists"],
      setting: "Sanctuary Brewing Vat Hall",
      references: "",
      canonicalSceneId: "scene-freezer",
      sceneZone: "Sanctuary Brewing Vat Hall",
      visualPrompt: "",
    },
  ] as any[];

  const clips = internals.deriveWorkflowClipsFromShots(shots);

  assert.equal(clips.length, 1);
  assert.deepEqual(clips[0].shotIds, ["altar-1", "altar-2", "altar-3", "altar-4", "altar-5", "hiss-1"]);
  assert.ok(clips[0].estimatedDuration <= 15, `expected merged clip to stay <= 15s, got ${clips[0].estimatedDuration}s`);
});

test("deriveWorkflowClipsFromShots merges isolated travel establishing shots instead of creating 2s clips", () => {
  const shots = [
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `exit-${index + 1}`,
      title: `Fungal shelter exit ${index + 1}`,
      description: "The team escapes the fungal shelter on a motorcycle.",
      action: "The motorcycle rushes toward the exit.",
      dialogue: "",
      durationSeconds: 2,
      shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Chloe", "Bob", "Leo"],
      setting: "Fungal Shelter Exit",
      references: "",
      canonicalSceneId: "scene-frozen-meat-section",
      sceneZone: "Fungal Shelter Exit",
      visualPrompt: "",
    })),
    {
      id: "road-1",
      title: "腐烂城市环线",
      description: "城市环线像腐烂拼盘，废车塞满道路。",
      action: "摩托在废弃车辆间高速穿梭。",
      dialogue: "",
      durationSeconds: 2,
      shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Chloe", "Bob", "Leo"],
      setting: "Ruined City Ring Road",
      references: "",
      canonicalSceneId: "scene-ruined-city-ring-road",
      sceneZone: "Ruined City Ring Road",
      visualPrompt: "",
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `toll-${index + 1}`,
      title: `Deadline toll station ${index + 1}`,
      description: "The toll station confrontation begins.",
      action: "The motorcycle stops before the rusty toll gate.",
      dialogue: index === 0 ? "Bob: What is that?" : "",
      durationSeconds: 2,
      shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Chloe", "Bob", "Leo"],
      setting: "Deadline Toll Station",
      references: "",
      canonicalSceneId: "scene-deadline-toll-station",
      sceneZone: "Deadline Toll Station",
      visualPrompt: "",
    })),
  ] as any[];

  const clips = internals.deriveWorkflowClipsFromShots(shots);

  assert.equal(clips.length, 2);
  assert.deepEqual(clips[0].shotIds, ["exit-1", "exit-2", "exit-3", "exit-4", "exit-5", "road-1"]);
  assert.ok(
    clips.every((clip: any) => clip.estimatedDuration >= 5),
    `expected no tiny clips, got ${clips.map((clip: any) => `${clip.id}:${clip.estimatedDuration}s`).join(", ")}`,
  );
});

test("deriveWorkflowClipsFromShots expands sparse 15 second clips beyond five 3-second shots", () => {
  const shots = Array.from({ length: 5 }, (_, index) => ({
    id: `sparse-${index + 1}`,
    title: `Sparse ${index + 1}`,
    description: "Chloe fights through the loading dock.",
    action: "Chloe fights through the loading dock.",
    dialogue: index === 1 ? "Flora: Murder!" : "",
    durationSeconds: 3,
    shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
    aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
    characters: ["Chloe", "Flora"], setting: "Underground Loading Dock", references: "",
  })) as any[];

  const paced = internals.rebalanceStoryboardPacing(shots);
  const clips = internals.deriveWorkflowClipsFromShots(paced);

  assert.ok(paced.length >= 7, `expected at least 7 shots, got ${paced.length}`);
  assert.ok(paced.some((shot: any) => shot.durationSeconds < 3), `expected mixed durations, got ${paced.map((shot: any) => shot.durationSeconds).join(",")}`);
  assert.ok(clips[0].shotIds.length >= 7, `expected at least 7 clip shots, got ${clips[0].shotIds.length}`);
  assert.equal(clips[0].seedancePrompt, "");
  const generatedPrompt = regeneratePromptForClip(clips[0], paced.filter((shot: any) => clips[0].shotIds.includes(shot.id)));
  assert.ok(generatedPrompt.includes("S7:"), generatedPrompt);
});

test("rebalanceStoryboardPacing does not generate generic spoken-line reaction boilerplate", () => {
  const paced = internals.rebalanceStoryboardPacing([
    {
      id: "flora-long-line",
      title: "Flora lectures",
      description: "Flora raises the bone needle and smiles down coldly.",
      action: "Flora steadies the tubing with one hand, facing Chloe.",
      dialogue: "Flora: Stop struggling, darling. Anger only accelerates your blood flow. While that does speed up the integration process, it just causes you unnecessary pain.",
      durationSeconds: 3,
      shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Chloe", "Flora"], setting: "Living Vine Hospital Bed", references: "Flora holds Massive Bone Needle connected to Clear Plastic Tubing.",
    },
  ] as any[]);

  const joined = paced.map((shot: any) => `${shot.action} ${shot.description}`).join("\n");
  assert.doesNotMatch(joined, /absorbs the spoken line/i);
  assert.match(joined, /restraint|tubing|vine pressure|ritual authority|reaction/i);
});

test("rebalanceStoryboardPacing does not split a complete dialogue sentence mid-line", () => {
  const shots = [
    {
      id: "long-dialogue",
      title: "Rotten Meat Line",
      description: "Chloe argues with Flora at the loading dock.",
      action: "Chloe keeps Flora back from the corpse.",
      dialogue: "Chloe: Well, if you'd rather go breathe with that pile of rotten meat, I'm happy to toss you outside.",
      durationSeconds: 2,
      shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Chloe", "Flora"], setting: "Underground Loading Dock", references: "",
    },
  ] as any[];

  const paced = internals.rebalanceStoryboardPacing(shots);

  assert.equal(
    paced.filter((shot: any) => /Chloe: Well, if you'd rather go breathe with that pile of rotten meat/.test(shot.dialogue)).length,
    1,
  );
  assert.ok(paced.every((shot: any) => !/^meat, I'm happy to toss you outside\./.test(shot.dialogue)));
});

test("rebalanceStoryboardPacing keeps multi-sentence speaker turns atomic with silent coverage", () => {
  const fullDialogue = "Flora: My dear children, thank you for your hard work today. Under the Earth Mother's watchful eye, your sweat shall become nutrients for the altar.";
  const paced = internals.rebalanceStoryboardPacing([
    {
      id: "flora-pa",
      title: "Flora PA Announcement",
      description: "Flora addresses the cafeteria over the PA.",
      action: "Flora speaks ceremonially while the cafeteria listens.",
      dialogue: fullDialogue,
      durationSeconds: 2,
      shotSize: "", cameraAngle: "", cameraMove: "", composition: "", lens: "",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Flora", "Chloe", "Bob", "Leo"], setting: "Sanctuary Cafeteria", references: "",
    },
  ] as any[]);
  const dialogueShots = paced.filter((shot: any) => String(shot.dialogue || "").trim());

  assert.equal(dialogueShots.length, 1);
  assert.equal(dialogueShots[0].dialogue, fullDialogue);
  assert.ok(paced.length >= 2);
  assert.ok(paced.slice(1).every((shot: any) => !String(shot.dialogue || "").trim()));
});

test("normalizeBreakdown merges GPT-fragmented dialogue before clips and canvas sync", () => {
  const normalized = internals.normalizeBreakdown({
    characters: [],
    locations: [],
    props: [],
    storyboard: [
      {
        title: "Line A",
        description: "Chloe argues with Flora.",
        action: "Chloe keeps Flora away from the corpse.",
        dialogue: "Chloe: Well, if you'd rather go breathe",
        durationSeconds: 2,
        characters: ["Chloe", "Flora"],
        setting: "Underground Loading Dock",
        visualPrompt: "",
      },
      {
        title: "Line B",
        description: "Flora reacts.",
        action: "Flora recoils.",
        dialogue: "with that pile of rotten",
        durationSeconds: 1,
        characters: ["Chloe", "Flora"],
        setting: "Underground Loading Dock",
        visualPrompt: "",
      },
      {
        title: "Line C",
        description: "Bob watches.",
        action: "Bob hesitates.",
        dialogue: "meat, I'm happy to toss you outside.",
        durationSeconds: 1,
        characters: ["Chloe", "Flora", "Bob"],
        setting: "Underground Loading Dock",
        visualPrompt: "",
      },
    ],
  }, {
    sourceText: "Chloe says the full line.",
    sourceName: "test",
    selectedEpisode: "Episode 1",
    stage: "storyboard",
  } as any);

  assert.match(
    normalized.storyboard[0].dialogue,
    /Chloe: Well, if you'd rather go breathe with that pile of rotten meat, I'm happy to toss you outside\./,
  );
  assert.equal(normalized.storyboard[1].dialogue, "");
  assert.equal(normalized.storyboard[2].dialogue, "");
  assert.equal(normalized.clips[0].seedancePrompt, "");
  const generatedPrompt = regeneratePromptForClip(
    normalized.clips[0],
    normalized.storyboard.filter((shot: any) => normalized.clips[0].shotIds.includes(shot.id)),
  );
  assert.match(
    generatedPrompt,
    /Chloe: “Well, if you'd rather go breathe with that pile of rotten meat, I'm happy to toss you outside\.”/,
  );
});

test("normalizeBreakdown repairs source-locked multi-sentence dialogue split across complete storyboard lines", () => {
  const sourceDialogue = "My dear children, thank you for your hard work today. Under the Earth Mother's watchful eye, your sweat shall become nutrients for the altar.";
  const normalized = internals.normalizeBreakdown({
    characters: [],
    locations: [],
    props: [],
    storyboard: [
      {
        title: "PA line first half",
        description: "Flora speaks over the cafeteria PA.",
        action: "The cafeteria listens.",
        dialogue: "Flora: My dear children, thank you for your hard work today.",
        durationSeconds: 2,
        characters: ["Flora", "Chloe", "Bob"],
        setting: "Sanctuary Cafeteria",
        visualPrompt: "",
      },
      {
        title: "PA line second half",
        description: "Chloe and Bob react.",
        action: "Chloe and Bob stay tense in the corner.",
        dialogue: "Flora: Under the Earth Mother's watchful eye, your sweat shall become nutrients for the altar.",
        durationSeconds: 2,
        characters: ["Flora", "Chloe", "Bob"],
        setting: "Sanctuary Cafeteria",
        visualPrompt: "",
      },
    ],
  }, {
    sourceText: `"${sourceDialogue}"`,
    sourceName: "test",
    selectedEpisode: "Episode 1",
    stage: "storyboard",
  } as any);

  assert.equal(normalized.storyboard[0].dialogue, `Flora: ${sourceDialogue}`);
  assert.equal(normalized.storyboard[1].dialogue, "");
  const generatedPrompt = regeneratePromptForClip(
    normalized.clips[0],
    normalized.storyboard.filter((shot: any) => normalized.clips[0].shotIds.includes(shot.id)),
  );
  assert.match(generatedPrompt, /Flora: “My dear children, thank you for your hard work today\. Under the Earth Mother's watchful eye/);
});

test("normalizeBreakdown maps Chinese character aliases to existing canonical names while preserving Chinese dialogue", () => {
  const normalized = internals.normalizeBreakdown({
    summary: "克洛伊回应弗洛拉。",
    characters: [
      { name: "克洛伊", role: "PROTAGONIST", description: "克洛伊举枪。", visualPrompt: "克洛伊角色参考图" },
    ],
    locations: [],
    props: [],
    storyboard: [
      {
        title: "克洛伊反击",
        description: "克洛伊看向弗洛拉。",
        action: "克洛伊举起霰弹枪，挡在左侧。",
        dialogue: "克洛伊：别过来。",
        durationSeconds: 2,
        characters: ["克洛伊", "弗洛拉"],
        setting: "地下装卸区",
        references: "克洛伊在画面左侧。",
        visualPrompt: "克洛伊中景，弗洛拉在右侧。",
      },
    ],
  }, {
    sourceText: "克洛伊看向弗洛拉，说：“别过来。”",
    sourceName: "test-cn",
    selectedEpisode: "第 14 集",
    stage: "storyboard",
  } as any, { settings: {}, aspectRatio: "16:9" } as any, {
    globalPrompt: "",
    negativePrompt: "",
    setupSettings: {},
    setupSettingsSummary: "",
    characterIdentityRules: "",
    requiresSpecificFruitIdentity: false,
    existingCharacters: [
      { name: "Chloe", role: "PROTAGONIST", bio: "Existing Chloe", prompt: "Chloe visual authority", traits: {} },
      { name: "Flora", role: "SUPPORTING", bio: "Existing Flora", prompt: "Flora visual authority", traits: {} },
    ],
  } as any);

  assert.equal(normalized.characters[0].name, "Chloe");
  assert.deepEqual(normalized.characters[0].aliases, ["克洛伊"]);
  assert.deepEqual(normalized.storyboard[0].characters, ["Chloe", "Flora"]);
  assert.equal(normalized.storyboard[0].dialogue, "Chloe: 别过来。");
  const generatedPrompt = regeneratePromptForClip(
    normalized.clips[0],
    normalized.storyboard.filter((shot: any) => normalized.clips[0].shotIds.includes(shot.id)),
  );
  assert.match(generatedPrompt, /Exact dialogue: Chloe: “别过来。”/);
  assert.doesNotMatch(generatedPrompt, /克洛伊[:：]/);
});

test("buildShotOrderVideoBeats keeps explicit speaker instead of inferring wrong character", () => {
  const beats = internals.buildShotOrderVideoBeats([
    {
      id: "bob-line",
      title: "Bob Reacts",
      description: "Bob hesitates.",
      action: "Bob hesitates while Flora turns.",
      dialogue: "Bob: Wow, everyone first.",
      durationSeconds: 2,
      shotSize: "close-up", cameraAngle: "eye-level", cameraMove: "static hold", composition: "", lens: "85mm",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Flora", "Bob"], setting: "Underground Loading Dock", references: "",
    },
  ] as any[]);

  assert.equal(beats[0].dialogue, "Bob: Wow, everyone first.");
  assert.doesNotMatch(beats[0].dialogue ?? "", /^Flora: Bob:/);
});

test("buildShotOrderVideoBeats gives dialogue-only shots visible story action", () => {
  const beats = internals.buildShotOrderVideoBeats([
    {
      id: "dialogue-only",
      title: "Empty Action",
      description: "",
      action: "",
      dialogue: "Flora: Murder!",
      durationSeconds: 2,
      shotSize: "close-up", cameraAngle: "eye-level", cameraMove: "static hold", composition: "", lens: "85mm",
      aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
      characters: ["Flora"], setting: "Underground Loading Dock", references: "",
    },
  ] as any[]);

  assert.match(beats[0].text, /Flora speak|Flora speaks/);
  assert.match(internals.formatStoryboardVideoBeats(beats).lines.join("\n"), /Shot: .*close-up.*eye-level.*static hold.*85mm/i);
  assert.doesNotMatch(internals.formatStoryboardVideoBeats(beats).lines.join("\n"), /^S1: dialogue Flora: Murder!; camera close-up, eye-level, static hold, 85mm$/);
});

test("buildClipPreflight warns when shot count exceeds the 12-beat cap", () => {
  const preflight = internals.buildClipPreflight({
    estimatedDuration: 15,
    targetDuration: 15,
    maxDuration: 15,
    dialogueWordCount: 0,
    dialogueWordsPerSecond: 0,
    shotCount: 15,
    panelCount: 12,
    hasStartState: true,
    hasEndState: true,
  });
  assert.equal(preflight.pass, false);
  assert.ok(
    preflight.warnings.some((warning: string) => warning.includes("节拍上限") && warning.includes("12")),
    `expected shot-count warning, got: ${JSON.stringify(preflight.warnings)}`,
  );
});

test("extractVideoBeatLabels matches S beats and P beats with prefix preserved", () => {
  const sText = "S1: hero enters. Dialogue. S2: hero turns. S10: hero exits. S1: repeated.";
  assert.deepEqual(internals.extractVideoBeatLabels(sText), ["S1", "S2", "S10"]);
  const pText = "P1: setup. P2: payoff. P1: repeated.";
  assert.deepEqual(internals.extractVideoBeatLabels(pText), ["P1", "P2"]);
});

test("unwrapJsonWrappedPromptText unwraps JSON array/string wrappers and keeps plain text", () => {
  const inner = "Generate one continuous 12s cinematic video, 9:16.\nS1: dialogue Flora: Murder!; camera medium.";
  assert.equal(internals.unwrapJsonWrappedPromptText(JSON.stringify([inner])), inner);
  assert.equal(internals.unwrapJsonWrappedPromptText(JSON.stringify(inner)), inner);
  assert.equal(internals.unwrapJsonWrappedPromptText(inner), inner);
  assert.equal(internals.unwrapJsonWrappedPromptText('{"prompt":"abc"}'), "abc");
  assert.equal(internals.unwrapJsonWrappedPromptText('["not valid json'), '["not valid json');
});

const promptAuthority = {
  globalPrompt: "cinematic 3D dark comedy",
  negativePrompt: "No random text",
  setupSettings: {},
  setupSettingsSummary: "",
  characterIdentityRules: "",
  existingCharacters: [],
  requiresSpecificFruitIdentity: false,
};

test("breakdown prompt locks door-gap zombie event order and dialogue timing", () => {
  const sourceText = [
    "枪口喷出的火舌在阴暗的地下卸货区闪烁，散弹枪巨大的轰鸣声甚至盖过了卷帘门外丧尸的嘶吼。",
    "“砰——！”",
    "那只刚把头挤进门缝的丧尸瞬间变成了一朵爆开的、烂掉的西红柿。",
    "后面才接弗洛拉的话：“杀戮！这是赤裸裸的杀戮！”",
  ].join("\n\n");
  const prompt = internals.buildBreakdownPrompt(
    { name: "美式漫剧", description: "", aspectRatio: "16:9" },
    { sourceText, sourceName: "fixture", selectedEpisode: "第 1 集", stage: "full-breakdown" } as any,
    promptAuthority as any,
  );

  assert.match(prompt, /Preserve source event order exactly/);
  assert.match(prompt, /Do not make a character speak before/);
  assert.match(prompt, /刚把头挤进门缝的丧尸/);
  assert.match(prompt, /screen side or relative position/);
  assert.match(prompt, /Shot durations should vary between 1 and 3 seconds/);
});

test("buildBreakdownPrompt asks for Scene Visual Bible canonical scene rules", () => {
  const prompt = internals.buildBreakdownPrompt(
    { name: "美式漫剧", description: "", aspectRatio: "16:9" },
    {
      sourceText: "They speak in the same superstore sanctuary, then move to the pallet altar.",
      sourceName: "test",
      selectedEpisode: "Episode 1",
      stage: "full-breakdown",
    } as any,
    promptAuthority as any,
  );

  assert.match(prompt, /Scene Visual Bible/i);
  assert.match(prompt, /infer canonical scenes by visual identity/i);
  assert.match(prompt, /same time of day, color palette, building type, material language, lighting family, and fixed landmarks/i);
  assert.match(prompt, /Do not split a local altar, wall, aisle, door, or corner into a new visual world/i);
  assert.match(prompt, /canonicalSceneId/);
  assert.match(prompt, /sceneZone/);
  assert.match(prompt, /sceneAnchors/);
  assert.match(prompt, /sceneVisualLock/);
});

test("buildStoryboardOnlyPrompt requires storyboard settings to use visual bible ids", () => {
  const prompt = internals.buildStoryboardOnlyPrompt(
    { name: "美式漫剧", description: "", aspectRatio: "16:9" },
    {
      sourceText: "Flora judges Chloe at the pallet altar inside the superstore.",
      sourceName: "test",
      selectedEpisode: "Episode 1",
      stage: "storyboard",
    } as any,
    {
      characters: [],
      scenes: [
        {
          name: "Sanctuary Superstore Center",
          description: "green fabric superstore sanctuary",
          timeOfDay: "Interior dim",
        },
        {
          name: "Pallet Altar",
          description: "wooden pallet altar inside the sanctuary",
          timeOfDay: "Interior dim",
        },
      ],
      sceneVisualBibles: [
        {
          canonicalSceneId: "scene-1-sanctuary-superstore-center",
          canonicalName: "Sanctuary Superstore Center",
          visualIdentity: {
            timeOfDay: "Interior dim",
            lighting: "green filtered superstore lighting",
            colorPalette: "green fabric, gray concrete",
            buildingType: "abandoned big-box superstore",
            materialLanguage: "supermarket shelves, concrete floor, pallet altar",
            fixedLandmarks: ["green fabric strips", "pallet altar"],
          },
          childZones: [{ id: "zone-pallet-altar", name: "Pallet Altar", role: "anchor" }],
          aliases: ["pallet altar aisle"],
          continuityLock: "same canonical scene",
        },
      ],
      props: [],
    },
    promptAuthority as any,
  );

  assert.match(prompt, /Use the supplied Scene Visual Bible/i);
  assert.match(prompt, /parent canonical scene/i);
  assert.match(prompt, /scene-1-sanctuary-superstore-center/);
  assert.match(prompt, /canonicalSceneId/);
  assert.match(prompt, /sceneZone/);
  assert.match(prompt, /sceneAnchors/);
  assert.match(prompt, /sceneVisualLock/);
});

test("storyboard prompt uses workflow-level scene visual bibles when assets omit them", () => {
  const workflow = {
    sceneVisualBibles: [
      {
        canonicalSceneId: "scene-1-sanctuary-superstore-center",
        canonicalName: "Sanctuary Superstore Center",
        visualIdentity: {
          timeOfDay: "Interior dim",
          lighting: "green filtered superstore lighting",
          colorPalette: "green fabric, gray concrete",
          buildingType: "abandoned big-box superstore",
          materialLanguage: "supermarket shelves, concrete floor, pallet altar",
          fixedLandmarks: ["green fabric strips", "pallet altar"],
        },
        childZones: [{ id: "zone-pallet-altar", name: "Pallet Altar", role: "anchor" }],
        aliases: ["pallet altar aisle"],
        continuityLock: "same canonical scene",
      },
    ],
    assets: {
      characters: [],
      scenes: [
        {
          name: "Sanctuary Superstore Center",
          description: "green fabric superstore sanctuary",
          timeOfDay: "Interior dim",
        },
      ],
      props: [],
    },
  };

  assert.equal((workflow.assets as any).sceneVisualBibles, undefined);

  const assetsForStoryboard = internals.workflowAssetsWithSceneVisualBiblesForStoryboard(workflow);
  const prompt = internals.buildStoryboardOnlyPrompt(
    { name: "美式漫剧", description: "", aspectRatio: "16:9" },
    {
      sourceText: "Flora judges Chloe at the pallet altar inside the superstore.",
      sourceName: "test",
      selectedEpisode: "Episode 1",
      stage: "storyboard",
    } as any,
    assetsForStoryboard,
    promptAuthority as any,
  );

  assert.match(prompt, /scene-1-sanctuary-superstore-center/);
  assert.match(prompt, /green filtered superstore lighting/);
  assert.match(prompt, /zone-pallet-altar/);
});

test("clip seedance refinement prompt includes asset physical constraints", () => {
  const workflow = {
    sourceText: "Chloe keeps her helmet on while aiming.",
    clips: [],
    assets: {
      characters: [
        {
          name: "Chloe",
          primaryLook: "helmet on",
          lockedVisualIdentity: "Chloe always wears a sealed combat helmet in this scene",
          signatureProps: "shotgun",
        },
      ],
      scenes: [],
      props: [],
    },
  };
  const clip = {
    id: "clip-001",
    title: "Clip 01",
    setting: "Underground Loading Dock",
    characters: ["Chloe"],
    plotGoal: "Chloe aims after firing.",
    startState: "Chloe holds the shotgun.",
    endState: "Chloe still wears the helmet.",
    estimatedDuration: 8,
    layoutMemory: "",
    storyboardPrompt: "",
  };
  const prompt = internals.buildClipSeedancePromptRefinementPrompt({
    project: { name: "美式漫剧", aspectRatio: "16:9" },
    workflow,
    clip,
    shots: [
      {
        title: "Aim",
        action: "Chloe aims the shotgun without removing her helmet.",
        dialogue: "",
        characters: ["Chloe"],
        setting: "Underground Loading Dock",
        references: "Chloe helmet stays on",
        visualPrompt: "Chloe screen-left, helmet on, shotgun raised",
      },
    ],
    prompt: "S1: Chloe aims.",
    authority: promptAuthority,
  } as any);

  assert.match(prompt, /locked asset images/);
  assert.match(prompt, /helmets/);
  assert.match(prompt, /Only introduce a state change/);
  assert.match(prompt, /Carry state forward/);
  assert.match(prompt, /Chloe always wears a sealed combat helmet/);
});

test("clip seedance refinement prompt carries previous clip state memory", () => {
  const workflow = {
    sourceText: "Chloe dropped the shotgun and keeps talking.",
    clips: [
      {
        id: "clip-001",
        title: "Clip 01",
        startState: "Chloe holds the shotgun.",
        endState: "Chloe dropped the shotgun",
        layoutMemory: "Shotgun is on the floor near Chloe.",
      },
      {
        id: "clip-002",
        title: "Clip 02",
        startState: "Chloe talks empty-handed.",
        endState: "Chloe remains empty-handed.",
        layoutMemory: "",
      },
    ],
    assets: { characters: [], scenes: [], props: [] },
  };
  const clip = workflow.clips[1];
  const prompt = internals.buildClipSeedancePromptRefinementPrompt({
    project: { name: "美式漫剧", aspectRatio: "16:9" },
    workflow,
    clip,
    shots: [
      {
        title: "Talk",
        action: "Chloe talks with empty hands.",
        dialogue: "Chloe: Keep moving.",
        characters: ["Chloe"],
        setting: "Underground Loading Dock",
        references: "Shotgun remains on floor",
        visualPrompt: "Chloe screen-left, empty hands, facing right",
      },
    ],
    prompt: "S1: Chloe talks.",
    authority: promptAuthority,
  } as any);

  assert.match(prompt, /Previous clip state memory/);
  assert.match(prompt, /Chloe dropped the shotgun/);
  assert.match(prompt, /video model has no memory/);
});

test("composeSeedancePrompt requires explicit beat blocking and physical state", () => {
  const prompt = internals.composeSeedancePrompt({
    estimatedDuration: 8,
    aspectRatio: "16:9",
    visualStyle: "dark comedy",
    characterIdentities: {},
    setting: "Underground Loading Dock",
    characters: ["Chloe"],
    plotGoal: "Chloe reacts after the shot.",
    startState: "Chloe screen-left with shotgun lowered.",
    endState: "Chloe remains screen-left.",
    actions: ["Chloe lowers the shotgun."],
    dialogue: ["Chloe: Keep moving."],
    layoutMemory: "",
    storyboardControlLevel: "hard",
    storyboardType: "multi_panel",
    directorFreedom: "",
  } as any);

  assert.match(prompt, /Do not repeat these rules inside every beat/);
  assert.match(prompt, /carried-forward physical state only when it affects that shot/);
});

test("workflow asset history includes the current workflow asset id even when metadata matching is missing", () => {
  const matched = internals.workflowAssetHistoryRecordsForAsset(
    {
      referenceImageAssetId: "asset-current",
      referenceImageUrl: "https://example.com/current.png",
    },
    "characters",
    "Bob",
    [
      {
        id: "asset-current",
        title: "Bob selected canvas image",
        url: "https://example.com/current.png",
        metadata: { source: "canvas-image-generation" },
      },
      {
        id: "asset-other",
        title: "Other image",
        url: "https://example.com/other.png",
        metadata: { workflowAssetKind: "characters", assetName: "Other" },
      },
    ] as any[],
  );

  assert.deepEqual(matched.map((asset: any) => asset.id), ["asset-current"]);
});

test("workflow asset history builds current asset lookup filters", () => {
  const filters = internals.workflowAssetCurrentRecordFilters({
    referenceImageAssetId: "asset-current",
    generatedImageAssetId: "asset-current",
    referenceImageUrl: "https://example.com/current.png",
    generatedImageUrl: "https://example.com/current.png",
  });

  assert.deepEqual(filters, [
    { id: { in: ["asset-current"] } },
    { url: { in: ["https://example.com/current.png"] } },
  ]);
});

test("workflow asset history keeps current records before recent records when merging", () => {
  const records = internals.mergeAssetRecordsById(
    [{ id: "old-current", title: "Current image" }],
    [{ id: "new-recent", title: "Recent image" }, { id: "old-current", title: "Duplicate current" }],
  );

  assert.deepEqual(records.map((asset: any) => asset.title), ["Current image", "Recent image"]);
});

test("video prompt camera-plan enforcement restores camera language after refinement", () => {
  const prompt = internals.enforceShotCameraPlansInVideoPrompt(
    [
      "Generate one continuous 8s cinematic video, 16:9.",
      "S1: Chloe fires at the cracked shutter.",
      "S2: dialogue Flora: Murder! Flora points from screen-right.",
    ].join("\n"),
    [
      {
        id: "s1",
        title: "Shot",
        description: "Chloe fires.",
        action: "Chloe fires at the cracked shutter.",
        dialogue: "",
        durationSeconds: 2,
        shotSize: "wide shot",
        cameraAngle: "low angle",
        cameraMove: "fast dolly-in",
        composition: "Chloe screen-left, shutter screen-right, zombie head in the door gap",
        lens: "24mm",
        aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
        characters: ["Chloe"], setting: "Underground Loading Dock", references: "", visualPrompt: "",
      },
      {
        id: "s2",
        title: "Reaction",
        description: "Flora points.",
        action: "Flora points from screen-right.",
        dialogue: "Flora: Murder!",
        durationSeconds: 2,
        shotSize: "close-up",
        cameraAngle: "eye-level",
        cameraMove: "static hold",
        composition: "Flora screen-right facing screen-left, Chloe visible over shoulder",
        lens: "85mm",
        aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
        characters: ["Flora", "Chloe"], setting: "Underground Loading Dock", references: "", visualPrompt: "",
      },
    ] as any[],
  );

  assert.match(prompt, /S1: Shot: wide shot; low angle; fast dolly-in; 24mm; blocking: Chloe screen-left/);
  assert.match(prompt, /S2: Shot: close-up; eye-level; static hold; 85mm; blocking: Flora screen-right/);
});

test("normalizeBreakdown stores scene visual bible and locks sub-area storyboard settings", () => {
  const normalized = internals.normalizeBreakdown({
    characters: [],
    locations: [
      {
        name: "Sanctuary Superstore Center",
        description: "Former superstore center converted into a cult meditation circle with green fabric strips and incense haze.",
        timeOfDay: "Interior dim",
      },
      {
        name: "Bulk Toilet Paper Aisle Meditation Circle",
        description: "Aisle repurposed as a trial space with hundreds of green-dyed strips hanging from the ceiling.",
        timeOfDay: "Interior dim",
      },
      {
        name: "Pallet Altar",
        description: "Makeshift altar built from wooden shipping pallets where Flora judges prisoners from above.",
        timeOfDay: "Interior dim",
      },
    ],
    props: [],
    storyboard: [
      {
        title: "Trial begins",
        description: "Flora judges from the pallet altar.",
        action: "Flora stands above Chloe at the pallet altar while green strips hang overhead.",
        dialogue: "Flora: You are accused!",
        durationSeconds: 2,
        characters: ["Flora", "Chloe"],
        setting: "Pallet altar aisle",
      },
    ],
  }, {
    sourceText: "The trial continues inside the same superstore sanctuary.",
    sourceName: "test",
    selectedEpisode: "Episode 1",
    stage: "full-breakdown",
  } as any);

  assert.ok(Array.isArray((normalized as any).sceneVisualBibles));
  assert.equal((normalized as any).sceneVisualBibles.length, 1);
  assert.equal((normalized as any).storyboard[0].canonicalSceneId, "scene-1-sanctuary-superstore-center");
  assert.match((normalized as any).storyboard[0].sceneVisualLock, /Scene visual authority: Sanctuary Superstore Center/);
  assert.match((normalized as any).storyboard[0].sceneVisualLock, /Do not change.*time.*palette.*building type/i);
});

test("workflow episode write/read preserves scene visual bible and storyboard lock fields", () => {
  const input = {
    sourceText: "The trial continues inside the same superstore sanctuary.",
    sourceName: "test",
    selectedEpisode: "Episode 1",
    stage: "full-breakdown",
  } as any;
  const normalized = internals.normalizeBreakdown({
    characters: [],
    locations: [
      {
        name: "Sanctuary Superstore Center",
        description: "Former superstore center converted into a cult meditation circle with green fabric strips and incense haze.",
        timeOfDay: "Interior dim",
      },
      {
        name: "Bulk Toilet Paper Aisle Meditation Circle",
        description: "Aisle repurposed as a trial space with hundreds of green-dyed strips hanging from the ceiling.",
        timeOfDay: "Interior dim",
      },
      {
        name: "Pallet Altar",
        description: "Makeshift altar built from wooden shipping pallets where Flora judges prisoners from above.",
        timeOfDay: "Interior dim",
      },
    ],
    props: [],
    storyboard: [
      {
        title: "Trial begins",
        description: "Flora judges from the pallet altar.",
        action: "Flora stands above Chloe at the pallet altar while green strips hang overhead.",
        dialogue: "Flora: You are accused!",
        durationSeconds: 2,
        characters: ["Flora", "Chloe"],
        setting: "Pallet altar aisle",
      },
    ],
  }, input);
  const workflow = {
    sourceText: input.sourceText,
    sourceName: input.sourceName,
    selectedEpisode: input.selectedEpisode,
    activeStage: "storyboard",
    breakdownScenes: internals.workflowBreakdownScenesFromNormalizedStoryboard((normalized as any).storyboard),
    clips: (normalized as any).clips,
    sceneVisualBibles: (normalized as any).sceneVisualBibles,
    assets: {
      characters: (normalized as any).characters,
      scenes: (normalized as any).locations,
      props: (normalized as any).props,
    },
  };

  const metadata = internals.writeWorkflowEpisode({}, "episode-001", workflow, true);
  const state = internals.getWorkflowState(metadata, "episode-001");

  assert.equal(state.sceneVisualBibles.length, 1);
  assert.equal(state.breakdownScenes[0].canonicalSceneId, "scene-1-sanctuary-superstore-center");
  assert.match(state.breakdownScenes[0].sceneVisualLock, /Scene visual authority/);
  assert.equal(state.breakdownScenes[0].sceneZone, "Pallet Altar");
  assert.deepEqual(state.breakdownScenes[0].sceneAnchors, ["Pallet Altar"]);
});

test("resolveWorkflowEpisodeId falls back to active episode for stale unknown ids", () => {
  const metadata = internals.writeWorkflowEpisode(
    {
      activeEpisodeId: "episode-001",
      episodes: {},
    },
    "episode-001",
    {
      sourceText: "story",
      sourceName: "episode",
      selectedEpisode: "第 9 集",
      breakdownScenes: [],
      clips: [],
      assets: { characters: [], scenes: [], props: [] },
      stageStatuses: {},
    },
    true,
  );

  assert.equal(internals.resolveWorkflowEpisodeId(metadata, "episode-009"), "episode-001");
});

test("normalizeBreakdown allows assets-only JSON during asset extraction", () => {
  const normalized = internals.normalizeBreakdown({
    summary: "Asset extraction only.",
    characters: [{ name: "Chloe", role: "PROTAGONIST", description: "Apple delivery survivor." }],
    locations: [{ name: "Confession Room", description: "Small green-lit back room." }],
    props: [{ name: "Veggie juice cup", description: "Radioactive green drink." }],
  }, {
    sourceText: "story",
    sourceName: "episode",
    selectedEpisode: "第 10 集",
    stage: "assets",
  } as any);

  assert.equal(normalized.characters.length, 1);
  assert.equal(normalized.locations.length, 1);
  assert.equal(normalized.props.length, 1);
  assert.equal(normalized.storyboard.length, 0);
  assert.equal(normalized.clips.length, 0);
});

test("workflow read backfills scene visual locks for legacy storyboard and scene assets", () => {
  const sceneVisualBibles = internals.normalizeBreakdown({
    characters: [],
    locations: [
      {
        name: "Sanctuary Superstore Center",
        description: "Former superstore center converted into a cult meditation circle with green fabric strips and incense haze.",
        timeOfDay: "Interior dim",
      },
      {
        name: "Pallet Altar",
        description: "Makeshift altar built from wooden shipping pallets where Flora judges prisoners from above.",
        timeOfDay: "Interior dim",
      },
    ],
    props: [],
    storyboard: [
      {
        title: "Trial begins",
        description: "Flora judges from the pallet altar.",
        action: "Flora stands above Chloe at the pallet altar while green strips hang overhead.",
        dialogue: "Flora: You are accused!",
        durationSeconds: 2,
        characters: ["Flora", "Chloe"],
        setting: "Pallet altar aisle",
      },
    ],
  }, {
    sourceText: "The trial continues inside the same superstore sanctuary.",
    sourceName: "test",
    selectedEpisode: "Episode 1",
    stage: "full-breakdown",
  } as any).sceneVisualBibles;

  const metadata = internals.writeWorkflowEpisode({}, "episode-001", {
    sourceText: "The trial continues inside the same superstore sanctuary.",
    sourceName: "test",
    selectedEpisode: "Episode 1",
    activeStage: "storyboard",
    sceneVisualBibles,
    breakdownScenes: [
      {
        id: "shot-001",
        title: "Trial begins",
        description: "Flora judges from the pallet altar.",
        action: "Flora stands above Chloe at the pallet altar while green strips hang overhead.",
        dialogue: "Flora: You are accused!",
        durationSeconds: 2,
        characters: ["Flora", "Chloe"],
        setting: "Pallet altar aisle",
        canonicalSceneId: "",
        sceneVisualLock: "",
        sceneZone: "",
        sceneAnchors: [],
      },
    ],
    clips: [],
    assets: {
      characters: [],
      scenes: [
        {
          name: "Pallet Altar",
          description: "Makeshift altar built from wooden shipping pallets where Flora judges prisoners from above.",
          sceneVisualLock: "",
        },
      ],
      props: [],
    },
  }, true);

  assert.match(
    (metadata as any).workflowCenter.breakdownScenes[0].sceneVisualLock,
    /Scene visual authority: Sanctuary Superstore Center/,
  );
  assert.match(
    (metadata as any).workflowCenter.assets.scenes[0].sceneVisualLock,
    /Scene visual authority: Sanctuary Superstore Center/,
  );

  const state = internals.getWorkflowState(metadata, "episode-001");

  assert.equal(state.breakdownScenes[0].canonicalSceneId, "scene-1-sanctuary-superstore-center");
  assert.match(state.breakdownScenes[0].sceneVisualLock, /Scene visual authority: Sanctuary Superstore Center/);
  assert.equal(state.breakdownScenes[0].sceneZone, "Pallet Altar");
  assert.match((state.assets as any).scenes[0].sceneVisualLock, /Scene visual authority: Sanctuary Superstore Center/);
  assert.equal((state.assets as any).scenes[0].canonicalSceneId, "scene-1-sanctuary-superstore-center");
});

test("normalizeBreakdown locks fungus wall detail to frozen meat section", () => {
  const normalized = internals.normalizeBreakdown({
    characters: [],
    locations: [
      {
        name: "Frozen Meat Section",
        description: "Powerless freezer aisle with sickly sweet rot stench and white pulsing fungus on the walls.",
        timeOfDay: "Interior dark",
      },
      {
        name: "Fungus-Covered Drywall",
        description: "Dim wall coated in lace-like white fungus that squirms and whispers through cracks.",
        timeOfDay: "Interior dark",
      },
    ],
    storyboard: [
      {
        title: "Wall whispers",
        description: "The fungus-covered wall whispers to Chloe.",
        action: "Chloe studies the white fungus spreading across the freezer wall.",
        dialogue: "",
        durationSeconds: 2,
        characters: ["Chloe"],
        setting: "Fungus-covered drywall",
      },
    ],
  }, {
    sourceText: "Inside the frozen meat section, the wall whispers.",
    sourceName: "test",
    selectedEpisode: "Episode 1",
    stage: "full-breakdown",
  } as any);

  assert.equal((normalized as any).storyboard[0].canonicalSceneId, "scene-1-frozen-meat-section");
  assert.match((normalized as any).storyboard[0].sceneVisualLock, /Frozen Meat Section/);
  assert.match((normalized as any).storyboard[0].sceneVisualLock, /freezer|cold|frozen/i);
});

test("normalizeBreakdown does not lock living vine hospital bed to frozen meat section", () => {
  const normalized = internals.normalizeBreakdown({
    characters: [],
    locations: [
      {
        name: "Frozen Meat Section",
        description: "Powerless freezer aisle with sickly sweet rot stench and white pulsing fungus on the walls.",
        timeOfDay: "Interior dark",
      },
      {
        name: "Living Vine Hospital Bed",
        description: "Ritual bed woven from active vines, tendrils, fungal threads, root restraints, bone needle, and clear plastic tubing.",
        timeOfDay: "Interior ritual chamber",
      },
    ],
    storyboard: [
      {
        title: "Altar reveal",
        description: "Chloe lies bound on the living vine hospital bed while Flora steadies the clear tubing.",
        action: "Chloe lies bound center; Flora stands at the head facing her.",
        dialogue: "",
        durationSeconds: 2,
        characters: ["Chloe", "Flora"],
        setting: "Living Vine Hospital Bed",
      },
    ],
  }, {
    sourceText: "Inside the living vine hospital bed chamber, Flora prepares the bone needle and clear tubing.",
    sourceName: "test",
    selectedEpisode: "Episode 12",
    stage: "full-breakdown",
  } as any);

  assert.equal((normalized as any).storyboard[0].canonicalSceneId, "scene-1-living-vine-hospital-bed");
  assert.match((normalized as any).storyboard[0].sceneVisualLock, /Living Vine Hospital Bed/);
  assert.doesNotMatch((normalized as any).storyboard[0].sceneVisualLock, /Frozen Meat Section/);
});

test("scene asset image prompt inherits canonical visual lock for child anchors", () => {
  const prompt = internals.buildWorkflowAssetImagePromptForTest(
    {
      name: "美式漫剧",
      description: "",
      settings: {
        globalPrompt: "Base style: 欧美卡通",
        setupSettings: {},
      },
    },
    "scenes",
    "Pallet Altar",
    {
      name: "Pallet Altar",
      description: "Makeshift altar built from wooden shipping pallets where Flora judges prisoners from above.",
      timeOfDay: "Interior dim",
      canonicalSceneId: "scene-1-sanctuary-superstore-center",
      sceneZone: "Pallet Altar",
      sceneVisualLock: "Scene visual authority: Sanctuary Superstore Center. Current zone: Pallet Altar, inside the same canonical scene. Maintain: Interior dim; muted green; abandoned big-box superstore; supermarket shelves, shopping carts, concrete floor, green fabric strips.",
    },
  );

  assert.match(prompt, /Scene visual authority: Sanctuary Superstore Center/);
  assert.match(prompt, /Current zone: Pallet Altar/);
  assert.match(prompt, /Do not reinterpret this child zone as a separate warehouse/i);
  assert.match(prompt, /same time of day, color palette, building type, material language, lighting family, and fixed landmarks/i);
});

test("scene visual conflict warning reports visual-world drift", () => {
  const warning = internals.sceneVisualConflictWarningForTest(
    {
      canonicalSceneId: "scene-1-sanctuary-superstore-center",
      canonicalName: "Sanctuary Superstore Center",
      visualIdentity: {
        timeOfDay: "Interior dim",
        lighting: "dim superstore lighting with green fabric filtered light",
        colorPalette: "muted green, gray concrete, candle warm points",
        buildingType: "abandoned big-box superstore",
        materialLanguage: "supermarket shelves, shopping carts, concrete floor, green fabric strips",
        fixedLandmarks: ["green fabric strips", "supermarket shelves", "shopping carts", "meditation circle"],
        atmosphere: "eerie absurd cult sanctuary",
      },
      childZones: [],
      aliases: ["Pallet Altar"],
      continuityLock: "same canonical scene",
    },
    "red black night warehouse corner with brick wall and no supermarket shelves",
  );

  assert.match(warning, /视觉连续性风险/);
  assert.match(warning, /Sanctuary Superstore Center/);
  assert.match(warning, /building type drift|color palette drift|fixed landmark drift/);
});

test("project asset memory merges iron pan prop aliases and preserves existing image", () => {
  const metadata = {
    episodes: {
      "episode-012": {
        title: "第12集",
        workflowCenter: {
          selectedEpisode: "第12集",
          assets: {
            characters: [],
            scenes: [],
            props: [
              {
                id: "prop-9-cast-iron-pan",
                name: "Cast Iron Pan",
                description: "A heavy iron pan Chloe uses as a recurring weapon.",
                referenceImageUrl: "/api/uploads/public/asset-cast-iron-pan.png",
                referenceImageAssetId: "asset-cast-iron-pan",
              },
            ],
          },
        },
      },
    },
  };

  const extracted = internals.normalizeWorkflowAssets({
    props: [
      {
        name: "Cast Iron Frying Pan",
        description: "The same heavy frying pan appears again in the ritual scene.",
      },
    ],
  });
  const merged = internals.mergeExtractedAssetsWithProjectMemory(metadata, "episode-013", extracted);

  assert.equal(merged.props.length, 1);
  assert.equal(merged.props[0].name, "Cast Iron Pan");
  assert.equal(merged.props[0].referenceImageUrl, "/api/uploads/public/asset-cast-iron-pan.png");
  assert.equal(merged.props[0].referenceImageAssetId, "asset-cast-iron-pan");
  assert.ok((merged.props[0].aliases as string[]).includes("Cast Iron Frying Pan"));
  assert.match(String(merged.props[0].description), /ritual scene/);
});
