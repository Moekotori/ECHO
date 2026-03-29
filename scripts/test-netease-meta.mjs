/**
 * 一次性脚本：验证 NeteaseCloudMusicApiEnhanced 歌单拉取（不提交长期依赖）
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const require = createRequire(join(root, "package.json"));

const ncm = require("@neteasecloudmusicapienhanced/api");

// 网易云公开歌单示例（官方「热门华语」类歌单 ID 可能随时间变化，多试几个）
const SAMPLE_IDS = ["3779629", "2809513713", "745956155"];

async function main() {
  for (const id of SAMPLE_IDS) {
    console.log("\n--- playlist_detail id=%s ---", id);
    try {
      const d = await ncm.playlist_detail({ id });
      const pl = d.body?.playlist;
      console.log("status", d.status, "body.code", d.body?.code);
      console.log(
        "playlist?",
        !!pl,
        "name:",
        pl?.name,
        "trackIds:",
        pl?.trackIds?.length,
      );
    } catch (e) {
      console.log("REJECT:", e.body?.msg || e.body?.message || e.message || e);
    }
  }

  const okId = SAMPLE_IDS[0];
  console.log("\n--- playlist_track_all id=%s limit=5 ---", okId);
  try {
    const a = await ncm.playlist_track_all({
      id: okId,
      limit: 5,
      offset: 0,
    });
    console.log("songs:", a.body?.songs?.length, a.body?.songs?.[0]?.name);
  } catch (e) {
    console.log("REJECT:", e.body?.msg || e.message || e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
