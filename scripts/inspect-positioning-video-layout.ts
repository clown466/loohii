import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-023";

const project = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
const nodes = (project?.metadata as any)?.canvasScenes?.[episodeId]?.nodes ?? [];

for (const clip of ["clip-001", "clip-002", "clip-003"]) {
  console.log("---", clip);
  const sections = nodes.filter((node: any) => node.data?.clipId === clip && node.type === "section");
  for (const node of sections) {
    console.log(JSON.stringify({
      id: node.id,
      position: node.position,
      style: node.style,
      data: {
        title: node.data?.title,
        sectionKind: node.data?.sectionKind,
        positioningBoardFlow: node.data?.positioningBoardFlow,
      },
    }, null, 2));
  }
  const targets = nodes.filter((node: any) => node.data?.clipId === clip && (node.type === "video" || node.type === "generation"));
  for (const node of targets) {
    console.log(JSON.stringify({
      id: node.id,
      type: node.type,
      parentId: node.parentId,
      position: node.position,
      style: node.style,
      data: {
        title: node.data?.title,
        sectionKind: node.data?.sectionKind,
        clipNodeKind: node.data?.clipNodeKind,
        workflowKind: node.data?.workflowKind,
      },
    }, null, 2));
  }
}

await prisma.$disconnect();
