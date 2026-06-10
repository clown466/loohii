const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const config = read("server/src/config.ts");
const hermesAgent = read("server/src/lib/hermesAgent.ts");
const workflows = read("server/src/routes/workflows.ts");
const projectCanvas = read("src/app/pages/ProjectCanvasPage.tsx");

function assertIncludes(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `${label} should include: ${needle}`);
}

function assertFunctionIncludes(source, functionName, needle, label) {
  const index = source.indexOf(`function ${functionName}`);
  assert.ok(index >= 0, `missing function ${functionName}`);
  const nextFunction = source.indexOf("\nfunction ", index + 1);
  const body = source.slice(index, nextFunction >= 0 ? nextFunction : source.length);
  assertIncludes(body, needle, label);
}

assertIncludes(config, "HONCHO_BASE_URL", "config should read self-hosted Honcho base URL");
assertIncludes(config, "honchoMemoryConfigured", "config should expose Honcho memory availability");

assertIncludes(hermesAgent, "config.hermesAgent.honchoMemoryConfigured ? \"honcho\" : \"none\"", "Hermes status should recognize self-hosted Honcho memory");
assertIncludes(hermesAgent, "function projectGlobalSettingsFromProject", "Hermes payload should build global settings");
assertIncludes(hermesAgent, "globalSettings: projectGlobalSettings", "Hermes payload should attach project global settings");
assertIncludes(hermesAgent, "setupSettings", "Hermes payload should include setup settings");
assertIncludes(hermesAgent, "globalPrompt", "Hermes payload should include global prompt");
assertIncludes(hermesAgent, "negativePrompt", "Hermes payload should include negative prompt");

assertFunctionIncludes(workflows, "projectAuthorityPromptBlock", "Project global settings authority:", "workflow authority block should exist");
assertFunctionIncludes(workflows, "projectAuthorityPromptBlock", "mandatory for every inference", "workflow authority block should mark settings mandatory");
assertFunctionIncludes(workflows, "buildAssetExtractionPrompt", "projectAuthorityPromptBlock(authority)", "asset extraction should include project authority");
assertFunctionIncludes(workflows, "buildStoryboardOnlyPrompt", "projectAuthorityPromptBlock(authority)", "storyboard-only breakdown should include project authority");
assertFunctionIncludes(workflows, "buildBreakdownPrompt", "projectAuthorityPromptBlock(authority)", "full breakdown should include project authority");
assertFunctionIncludes(workflows, "buildClipOptimizationPrompt", "projectAuthorityPromptBlock(authority)", "clip optimization should include project authority");
assertFunctionIncludes(workflows, "buildClipStoryboardPlanPrompt", "projectAuthorityPromptBlock(authority)", "storyboard image prompt planning should include project authority");
assertFunctionIncludes(workflows, "buildClipSeedancePromptRefinementPrompt", "projectAuthorityPromptBlock(input.authority)", "video prompt refinement should include project authority");
assertIncludes(workflows, "Project global prompt: ${authority.globalPrompt}", "workflow prompts should pass global prompt explicitly");
assertIncludes(workflows, "Project negative prompt: ${authority.negativePrompt}", "workflow prompts should pass negative prompt explicitly");
assertIncludes(workflows, "Project setup settings: ${authority.setupSettingsSummary}", "workflow prompts should pass setup settings explicitly");

assertIncludes(projectCanvas, "await loadProjects();", "saving global settings should refresh project store");
assertIncludes(projectCanvas, "loadProjects, projectGlobalSettingsDraft", "save callback should depend on loadProjects");
assertIncludes(projectCanvas, "本项目的资产、分镜、故事板和视频提示词推理都会读取项目全局设定。", "canvas should explain global settings scope");

console.log("Global settings authority checks passed");
