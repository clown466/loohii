import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSceneVisualBible,
  detectSceneVisualConflict,
  formatSceneVisualLock,
  resolveSceneVisualLockForSetting,
} from "./sceneVisualContinuity";

test("buildSceneVisualBible keeps sanctuary zones under one visual authority", () => {
  const bibles = buildSceneVisualBible([
    {
      id: "loc-1",
      name: "Sanctuary Superstore Center",
      description: "Former superstore center converted into a cult meditation circle with green fabric strips and incense haze.",
      timeOfDay: "Interior dim",
    },
    {
      id: "loc-2",
      name: "Bulk Toilet Paper Aisle Meditation Circle",
      description: "Aisle repurposed as a trial space with hundreds of green-dyed strips hanging from the ceiling.",
      timeOfDay: "Interior dim",
    },
    {
      id: "loc-3",
      name: "Pallet Altar",
      description: "Makeshift altar built from wooden shipping pallets where Flora judges prisoners from above.",
      timeOfDay: "Interior dim",
    },
  ]);

  assert.equal(bibles.length, 1);
  assert.equal(bibles[0].canonicalSceneId, "scene-1-sanctuary-superstore-center");
  assert.equal(bibles[0].canonicalName, "Sanctuary Superstore Center");
  assert.deepEqual(
    bibles[0].childZones.map((zone) => zone.name),
    ["Bulk Toilet Paper Aisle Meditation Circle", "Pallet Altar"],
  );
  assert.match(bibles[0].continuityLock, /same canonical scene/i);
  assert.match(bibles[0].continuityLock, /green fabric/i);
  assert.match(bibles[0].continuityLock, /superstore/i);
});

test("sanctuary canonical id and name stay stable when inputs are reversed", () => {
  const scenes = [
    {
      id: "loc-1",
      name: "Sanctuary Superstore Center",
      description: "Former superstore center converted into a cult meditation circle with green fabric strips and incense haze.",
      timeOfDay: "Interior dim",
    },
    {
      id: "loc-2",
      name: "Bulk Toilet Paper Aisle Meditation Circle",
      description: "Aisle repurposed as a trial space with hundreds of green-dyed strips hanging from the ceiling.",
      timeOfDay: "Interior dim",
    },
    {
      id: "loc-3",
      name: "Pallet Altar",
      description: "Makeshift altar built from wooden shipping pallets where Flora judges prisoners from above.",
      timeOfDay: "Interior dim",
    },
  ];

  const forward = buildSceneVisualBible(scenes);
  const reversed = buildSceneVisualBible([...scenes].reverse());

  assert.equal(forward.length, 1);
  assert.equal(reversed.length, 1);
  assert.equal(forward[0].canonicalSceneId, "scene-1-sanctuary-superstore-center");
  assert.equal(reversed[0].canonicalSceneId, "scene-1-sanctuary-superstore-center");
  assert.equal(forward[0].canonicalName, "Sanctuary Superstore Center");
  assert.equal(reversed[0].canonicalName, "Sanctuary Superstore Center");
  assert.ok(reversed[0].aliases.includes("Bulk Toilet Paper Aisle Meditation Circle"));
});

test("resolveSceneVisualLockForSetting maps sub-area setting to canonical lock", () => {
  const bibles = buildSceneVisualBible([
    {
      id: "loc-1",
      name: "Sanctuary Superstore Center",
      description: "Former superstore center converted into a cult meditation circle with green fabric strips and incense haze.",
      timeOfDay: "Interior dim",
    },
    {
      id: "loc-2",
      name: "Pallet Altar",
      description: "Makeshift altar built from wooden shipping pallets where Flora judges prisoners from above.",
      timeOfDay: "Interior dim",
    },
  ]);

  const lock = resolveSceneVisualLockForSetting("Pallet altar aisle", bibles);

  assert.equal(lock?.canonicalSceneId, "scene-1-sanctuary-superstore-center");
  assert.equal(lock?.sceneZone, "Pallet Altar");
  assert.match(lock?.sceneVisualLock ?? "", /Sanctuary Superstore Center/);
  assert.match(lock?.sceneVisualLock ?? "", /must not become a different warehouse/i);
});

test("fungus wall stays visually locked to frozen meat section", () => {
  const bibles = buildSceneVisualBible([
    {
      id: "loc-1",
      name: "Frozen Meat Section",
      description: "Powerless freezer aisle with sickly sweet rot stench and white pulsing fungus on the walls.",
      timeOfDay: "Interior dark",
    },
    {
      id: "loc-2",
      name: "Fungus-Covered Drywall",
      description: "Dim wall coated in lace-like white fungus that squirms and whispers through cracks.",
      timeOfDay: "Interior dark",
    },
  ]);

  const lock = resolveSceneVisualLockForSetting("Fungus-covered drywall whisper", bibles);

  assert.equal(lock?.canonicalSceneId, "scene-1-frozen-meat-section");
  assert.equal(lock?.sceneZone, "Fungus-Covered Drywall");
  assert.match(lock?.sceneVisualLock ?? "", /Frozen Meat Section/);
  assert.match(lock?.sceneVisualLock ?? "", /freezer|cold|frozen/i);
});

test("living vine hospital bed is its own visual authority even with fungal threads", () => {
  const bibles = buildSceneVisualBible([
    {
      id: "loc-frozen",
      name: "Frozen Meat Section",
      description: "Powerless freezer aisle with white pulsing fungus on the walls.",
      timeOfDay: "Interior dark",
    },
    {
      id: "loc-vine-bed",
      name: "Living Vine Hospital Bed",
      description: "Ritual bed woven from active vines, tendrils, fungal threads, root restraints, bone needle, and clear plastic tubing.",
      timeOfDay: "Interior ritual chamber",
    },
  ]);

  const bed = bibles.find((bible) => bible.canonicalName === "Living Vine Hospital Bed");
  const frozen = bibles.find((bible) => bible.canonicalName === "Frozen Meat Section");
  const lock = resolveSceneVisualLockForSetting("Living Vine Hospital Bed", bibles);

  assert.equal(bibles.length, 2);
  assert.equal(bed?.canonicalSceneId, "scene-1-living-vine-hospital-bed");
  assert.equal(frozen?.canonicalSceneId, "scene-1-frozen-meat-section");
  assert.equal(lock?.canonicalSceneId, "scene-1-living-vine-hospital-bed");
  assert.match(lock?.sceneVisualLock ?? "", /Living Vine Hospital Bed/);
  assert.doesNotMatch(lock?.sceneVisualLock ?? "", /Frozen Meat Section/);
  assert.match(lock?.sceneVisualLock ?? "", /vine|tubing|bone needle/i);
});

test("superstore freezer aisle groups with frozen meat rather than sanctuary", () => {
  const bibles = buildSceneVisualBible([
    {
      id: "loc-1",
      name: "Sanctuary Superstore Center",
      description: "Former superstore center converted into a cult meditation circle with green fabric strips and incense haze.",
      timeOfDay: "Interior dim",
    },
    {
      id: "loc-2",
      name: "Superstore Freezer Aisle",
      description: "Cold freezer cases and frosted metal doors beside the frozen meat section.",
      timeOfDay: "Interior dark",
    },
    {
      id: "loc-3",
      name: "Frozen Meat Section",
      description: "Powerless freezer aisle with sickly sweet rot stench and white fungus.",
      timeOfDay: "Interior dark",
    },
  ]);

  const sanctuary = bibles.find((bible) => bible.canonicalName === "Sanctuary Superstore Center");
  const frozen = bibles.find((bible) => bible.canonicalName === "Frozen Meat Section");

  assert.equal(bibles.length, 2);
  assert.equal(sanctuary?.canonicalSceneId, "scene-1-sanctuary-superstore-center");
  assert.equal(frozen?.canonicalSceneId, "scene-1-frozen-meat-section");
  assert.deepEqual(
    frozen?.childZones.map((zone) => zone.name),
    ["Superstore Freezer Aisle"],
  );
  assert.equal(sanctuary?.childZones.some((zone) => zone.name === "Superstore Freezer Aisle"), false);
});

test("generic corridor and machinery scenes do not group under labor purification", () => {
  const bibles = buildSceneVisualBible([
    {
      id: "loc-1",
      name: "Labor Purification Zone Approach",
      description: "Back corridor marked for labor purification with pipes, conveyor belts, and a machinery glow ahead.",
      timeOfDay: "Interior dark",
    },
    {
      id: "loc-2",
      name: "Office Corridor",
      description: "Plain office corridor with beige drywall, framed notices, and closed meeting room doors.",
      timeOfDay: "Interior",
    },
    {
      id: "loc-3",
      name: "Machine Room",
      description: "Utility machine room with humming HVAC equipment and electrical panels.",
      timeOfDay: "Interior",
    },
  ]);

  const labor = bibles.find((bible) => bible.canonicalName === "Labor Purification Zone Approach");

  assert.equal(bibles.length, 3);
  assert.equal(labor?.canonicalSceneId, "scene-1-labor-purification-zone-approach");
  assert.deepEqual(labor?.childZones, []);
  assert.ok(bibles.some((bible) => bible.canonicalName === "Office Corridor"));
  assert.ok(bibles.some((bible) => bible.canonicalName === "Machine Room"));
});

test("labor and purification office names do not classify as labor purification", () => {
  const bibles = buildSceneVisualBible([
    {
      id: "loc-labor-purification",
      name: "Labor Purification Zone Approach",
      description: "Back corridor marked for labor purification with pipes and conveyor belts.",
      timeOfDay: "Interior dark",
    },
    {
      id: "loc-labor-office",
      name: "Labor Office",
      description: "Administrative office with desks, forms, filing cabinets, and a break room door.",
      timeOfDay: "Interior",
    },
    {
      id: "loc-purification-office",
      name: "Purification Office",
      description: "Administrative office for compliance records, plastic chairs, and fluorescent ceiling panels.",
      timeOfDay: "Interior",
    },
  ]);

  const labor = bibles.find((bible) => bible.canonicalName === "Labor Purification Zone Approach");

  assert.equal(bibles.length, 3);
  assert.equal(labor?.canonicalSceneId, "scene-1-labor-purification-zone-approach");
  assert.deepEqual(labor?.childZones, []);
  assert.ok(bibles.some((bible) => bible.canonicalName === "Labor Office"));
  assert.ok(bibles.some((bible) => bible.canonicalName === "Purification Office"));
});

test("generic scenes with the same stable id share one bible despite different descriptions", () => {
  const bibles = buildSceneVisualBible([
    {
      id: "loc-admin-office",
      name: "Administrative Office",
      description: "Plain office with beige drywall, cork boards, and a row of low desks.",
      timeOfDay: "Interior",
    },
    {
      id: "loc-admin-office",
      name: "Administrative Office",
      description: "Same office later framed toward metal filing cabinets and a copier alcove.",
      timeOfDay: "Interior",
    },
  ]);

  assert.equal(bibles.length, 1);
  assert.equal(bibles[0].canonicalName, "Administrative Office");
  assert.match(bibles[0].canonicalSceneId, /^scene-\d+-loc-admin-office$/);
});

test("generic scenes with the same stable id keep canonical id when input names reverse", () => {
  const recordsOffice = {
    id: "loc-records",
    name: "Records Office",
    description: "Office view toward binders, cork boards, and a service window.",
    timeOfDay: "Interior",
  };
  const recordsArchiveOffice = {
    id: "loc-records",
    name: "Records Archive Office",
    description: "Same records room later framed toward archive boxes and a copier alcove.",
    timeOfDay: "Interior",
  };

  const forward = buildSceneVisualBible([recordsOffice, recordsArchiveOffice]);
  const reversed = buildSceneVisualBible([recordsArchiveOffice, recordsOffice]);

  assert.equal(forward.length, 1);
  assert.equal(reversed.length, 1);
  assert.equal(forward[0].canonicalSceneId, reversed[0].canonicalSceneId);
  assert.match(forward[0].canonicalSceneId, /^scene-\d+-loc-records$/);
  assert.equal(forward[0].canonicalName, "Records Office");
  assert.equal(reversed[0].canonicalName, "Records Archive Office");
});

test("generic scenes with the same name share one bible when no stable id is present", () => {
  const bibles = buildSceneVisualBible([
    {
      name: "Records Office",
      description: "Office view toward binders, cork boards, and a service window.",
      timeOfDay: "Interior",
    },
    {
      name: "Records Office",
      description: "Office view toward stacked boxes, a copier, and a closed supply closet.",
      timeOfDay: "Interior",
    },
  ]);

  assert.equal(bibles.length, 1);
  assert.equal(bibles[0].canonicalName, "Records Office");
});

test("generic wall names do not group under frozen meat", () => {
  const bibles = buildSceneVisualBible([
    {
      id: "loc-1",
      name: "Frozen Meat Section",
      description: "Powerless freezer aisle with sickly sweet rot stench and white pulsing fungus on the walls.",
      timeOfDay: "Interior dark",
    },
    {
      id: "loc-2",
      name: "Apartment Wall",
      description: "Plain apartment wall with chipped paint and family photos.",
      timeOfDay: "Interior",
    },
    {
      id: "loc-3",
      name: "Warehouse Wall",
      description: "Bare warehouse wall with old paint and stacked boxes nearby.",
      timeOfDay: "Interior",
    },
  ]);

  const frozen = bibles.find((bible) => bible.canonicalName === "Frozen Meat Section");

  assert.equal(bibles.length, 3);
  assert.deepEqual(frozen?.childZones, []);
  assert.ok(bibles.some((bible) => bible.canonicalName === "Apartment Wall"));
  assert.ok(bibles.some((bible) => bible.canonicalName === "Warehouse Wall"));
});

test("detectSceneVisualConflict flags day green superstore versus red night warehouse", () => {
  const conflict = detectSceneVisualConflict(
    {
      canonicalSceneId: "scene-1-sanctuary-superstore-center",
      canonicalName: "Sanctuary Superstore Center",
      visualIdentity: {
        timeOfDay: "Interior dim",
        lighting: "cool dim superstore lighting with green fabric filtered light",
        colorPalette: "muted green, gray concrete, candle warm points",
        buildingType: "abandoned big-box superstore",
        materialLanguage: "supermarket shelves, shopping carts, concrete floor, green fabric strips",
        fixedLandmarks: ["green fabric strips", "supermarket shelves", "shopping carts", "meditation circle"],
        atmosphere: "eerie absurd cult sanctuary",
      },
      childZones: [],
      aliases: ["pallet altar"],
      continuityLock: "same canonical scene",
    },
    "red black night warehouse corner, industrial bricks, no supermarket shelves, no green fabric",
  );

  assert.equal(conflict.pass, false);
  assert.ok(conflict.reasons.some((reason) => /time of day/i.test(reason)));
  assert.ok(conflict.reasons.some((reason) => /building type/i.test(reason)));
  assert.ok(conflict.reasons.some((reason) => /color/i.test(reason)));
  assert.ok(conflict.reasons.some((reason) => /landmark/i.test(reason)));
});

test("detectSceneVisualConflict allows child-zone prompt preserving green superstore landmarks", () => {
  const conflict = detectSceneVisualConflict(
    {
      canonicalSceneId: "scene-1-sanctuary-superstore-center",
      canonicalName: "Sanctuary Superstore Center",
      visualIdentity: {
        timeOfDay: "Interior dim",
        lighting: "cool dim superstore lighting with green fabric filtered light",
        colorPalette: "muted green, gray concrete, candle warm points",
        buildingType: "abandoned big-box superstore",
        materialLanguage: "supermarket shelves, shopping carts, concrete floor, green fabric strips",
        fixedLandmarks: ["green fabric strips", "supermarket shelves", "shopping carts", "meditation circle"],
        atmosphere: "eerie absurd cult sanctuary",
      },
      childZones: [{ id: "anchor-1-pallet-altar", name: "Pallet Altar", role: "anchor", visualLock: "same sanctuary" }],
      aliases: ["pallet altar"],
      continuityLock: "same canonical scene",
    },
    "Pallet altar child zone inside the dim superstore sanctuary, green fabric strips filtering light over supermarket shelves, shopping carts, and the meditation circle.",
  );

  assert.equal(conflict.pass, true);
  assert.deepEqual(conflict.reasons, []);
});

test("detectSceneVisualConflict allows sanctuary prompt that omits some fixed landmarks", () => {
  const conflict = detectSceneVisualConflict(
    {
      canonicalSceneId: "scene-1-sanctuary-superstore-center",
      canonicalName: "Sanctuary Superstore Center",
      visualIdentity: {
        timeOfDay: "Interior dim",
        lighting: "cool dim superstore lighting with green fabric filtered light",
        colorPalette: "muted green, gray concrete, candle warm points",
        buildingType: "abandoned big-box superstore",
        materialLanguage: "supermarket shelves, shopping carts, concrete floor, green fabric strips",
        fixedLandmarks: ["green fabric strips", "supermarket shelves", "shopping carts", "meditation circle", "pallet altar"],
        atmosphere: "eerie absurd cult sanctuary",
      },
      childZones: [],
      aliases: ["pallet altar"],
      continuityLock: "same canonical scene",
    },
    "Dim superstore sanctuary view with green fabric strips filtering the light above a quiet pallet altar.",
  );

  assert.equal(conflict.pass, true);
  assert.deepEqual(conflict.reasons, []);
});

test("detectSceneVisualConflict flags explicit removal of sanctuary landmarks", () => {
  const conflict = detectSceneVisualConflict(
    {
      canonicalSceneId: "scene-1-sanctuary-superstore-center",
      canonicalName: "Sanctuary Superstore Center",
      visualIdentity: {
        timeOfDay: "Interior dim",
        lighting: "cool dim superstore lighting with green fabric filtered light",
        colorPalette: "muted green, gray concrete, candle warm points",
        buildingType: "abandoned big-box superstore",
        materialLanguage: "supermarket shelves, shopping carts, concrete floor, green fabric strips",
        fixedLandmarks: ["green fabric strips", "supermarket shelves", "shopping carts", "meditation circle", "pallet altar"],
        atmosphere: "eerie absurd cult sanctuary",
      },
      childZones: [],
      aliases: ["pallet altar"],
      continuityLock: "same canonical scene",
    },
    "Dim superstore sanctuary after cleanup, no green fabric and no supermarket shelves, with the pallet altar left behind.",
  );

  assert.equal(conflict.pass, false);
  assert.ok(conflict.reasons.some((reason) => /landmark/i.test(reason)));
});

test("detectSceneVisualConflict flags material language and lighting drift", () => {
  const conflict = detectSceneVisualConflict(
    {
      canonicalSceneId: "scene-1-sanctuary-superstore-center",
      canonicalName: "Sanctuary Superstore Center",
      visualIdentity: {
        timeOfDay: "Interior dim",
        lighting: "dim superstore lighting with green fabric filtered light and small warm practical points",
        colorPalette: "muted green, gray concrete, dull metal, warm candle accents",
        buildingType: "abandoned big-box superstore sanctuary",
        materialLanguage: "supermarket shelves, shopping carts, concrete floor, green fabric strips, pallets",
        fixedLandmarks: ["green fabric strips", "supermarket shelves", "shopping carts", "meditation circle", "pallet altar"],
        atmosphere: "eerie absurd cult sanctuary inside a mundane superstore",
      },
      childZones: [],
      aliases: ["bulk toilet paper aisle", "pallet altar aisle"],
      continuityLock: "same canonical scene",
    },
    "Sanctuary with green fabric strips, supermarket shelves, shopping carts, meditation circle, and pallet altar preserved, but redesigned with glossy marble floors, glass walls, and bright hospital-white fluorescent lighting.",
  );

  assert.equal(conflict.pass, false);
  assert.ok(conflict.reasons.some((reason) => /material language/i.test(reason)));
  assert.ok(conflict.reasons.some((reason) => /lighting family/i.test(reason)));
});

test("detectSceneVisualConflict flags loading dock changed to office suite", () => {
  const conflict = detectSceneVisualConflict(
    {
      canonicalSceneId: "scene-1-underground-loading-dock",
      canonicalName: "Underground Loading Dock",
      visualIdentity: {
        timeOfDay: "Interior dim",
        lighting: "dim industrial loading dock lighting",
        colorPalette: "dark concrete, gray metal, yellow hazard marks",
        buildingType: "underground loading dock",
        materialLanguage: "concrete walls, stainless blast door, roll-up door, pipes, pallets",
        fixedLandmarks: ["stainless blast door", "roll-up door", "concrete dock floor", "pallet stacks"],
        atmosphere: "tense underground loading bay",
      },
      childZones: [],
      aliases: [],
      continuityLock: "same canonical scene",
    },
    "Interior dim office suite preserving a stainless blast door, roll-up door, concrete dock floor, and pallet stacks.",
  );

  assert.equal(conflict.pass, false);
  assert.ok(conflict.reasons.some((reason) => /building type/i.test(reason)));
});

test("detectSceneVisualConflict flags frozen meat changed to warm sunlight", () => {
  const conflict = detectSceneVisualConflict(
    {
      canonicalSceneId: "scene-1-frozen-meat-section",
      canonicalName: "Frozen Meat Section",
      visualIdentity: {
        timeOfDay: "Interior dark",
        lighting: "cold dark freezer aisle lighting with blue-gray spill",
        colorPalette: "cold blue-gray, white fungus, dark freezer metal",
        buildingType: "superstore frozen meat freezer section",
        materialLanguage: "freezer cases, cold tile, metal doors, white lace-like fungus",
        fixedLandmarks: ["freezer cases", "white fungus", "cold tile floor", "dark freezer wall"],
        atmosphere: "cold powerless freezer aisle with unsettling fungal growth",
      },
      childZones: [],
      aliases: [],
      continuityLock: "same canonical scene",
    },
    "Frozen meat section with freezer cases and white fungus, but washed in warm sunlight and golden sunlight.",
  );

  assert.equal(conflict.pass, false);
  assert.ok(conflict.reasons.some((reason) => /lighting family/i.test(reason)));
});

test("detectSceneVisualConflict flags loading dock changed to glass atrium", () => {
  const conflict = detectSceneVisualConflict(
    {
      canonicalSceneId: "scene-1-underground-loading-dock",
      canonicalName: "Underground Loading Dock",
      visualIdentity: {
        timeOfDay: "Interior dim",
        lighting: "dim industrial loading dock lighting",
        colorPalette: "dark concrete, gray metal, yellow hazard marks",
        buildingType: "underground loading dock",
        materialLanguage: "concrete walls, stainless blast door, roll-up door, pipes, pallets",
        fixedLandmarks: ["stainless blast door", "roll-up door", "concrete dock floor", "pallet stacks"],
        atmosphere: "tense underground loading bay",
      },
      childZones: [],
      aliases: [],
      continuityLock: "same canonical scene",
    },
    "Interior dim glass atrium with transparent walls, polished entry flooring, and no industrial loading bay structure.",
  );

  assert.equal(conflict.pass, false);
  assert.ok(conflict.reasons.some((reason) => /building type/i.test(reason)));
  assert.ok(conflict.reasons.some((reason) => /material language/i.test(reason)));
});

test("detectSceneVisualConflict flags labor purification corridor changed to office cubicles", () => {
  const conflict = detectSceneVisualConflict(
    {
      canonicalSceneId: "scene-1-labor-purification-zone-approach",
      canonicalName: "Labor Purification Zone Approach",
      visualIdentity: {
        timeOfDay: "Interior dark",
        lighting: "cold corridor light with warm machinery glow ahead",
        colorPalette: "green-gray corridor shadows, orange industrial glow",
        buildingType: "superstore back corridor leading to machinery zone",
        materialLanguage: "pipes, conveyor belts, metal gates, cracked concrete, retail backroom walls",
        fixedLandmarks: ["pipes", "conveyor belts", "industrial doorway", "machinery glow"],
        atmosphere: "ominous backroom approach to purification machinery",
      },
      childZones: [],
      aliases: [],
      continuityLock: "same canonical scene",
    },
    "Interior dark office cubicles and a carpeted hallway with acoustic panels replacing the machinery approach.",
  );

  assert.equal(conflict.pass, false);
  assert.ok(conflict.reasons.some((reason) => /building type/i.test(reason)));
  assert.ok(conflict.reasons.some((reason) => /material language/i.test(reason)));
});

test("formatSceneVisualLock is compact enough for video prompts", () => {
  const text = formatSceneVisualLock({
    canonicalSceneId: "scene-1-sanctuary-superstore-center",
    canonicalName: "Sanctuary Superstore Center",
    visualIdentity: {
      timeOfDay: "Interior dim",
      lighting: "cool dim superstore lighting with green fabric filtered light",
      colorPalette: "muted green, gray concrete, candle warm points",
      buildingType: "abandoned big-box superstore",
      materialLanguage: "supermarket shelves, shopping carts, concrete floor, green fabric strips",
      fixedLandmarks: ["green fabric strips", "supermarket shelves", "shopping carts", "meditation circle"],
      atmosphere: "eerie absurd cult sanctuary",
    },
    childZones: [{ id: "zone-pallet-altar", name: "Pallet Altar", role: "anchor", visualLock: "wooden pallet altar inside the same superstore sanctuary" }],
    aliases: ["bulk toilet paper aisle", "pallet altar aisle"],
    continuityLock: "same canonical scene",
  }, "Pallet Altar");

  assert.ok(text.length < 700, `expected compact lock, got ${text.length}`);
  assert.match(text, /Scene visual authority: Sanctuary Superstore Center/);
  assert.match(text, /Current zone: Pallet Altar/);
  assert.match(text, /Do not change.*time.*palette.*building type/i);
});
