/* eslint-disable no-console */
/**
 * Generate the PWA icon set from the app's logo.
 *
 * Source (first one that exists wins): public/logo.png → public/icons/icon.svg
 * Outputs (all written to public/icons/):
 *   - icon-192x192.png            purpose "any"
 *   - icon-512x512.png            purpose "any"
 *   - icon-maskable-512x512.png   the logo sized to ~68% centered on the
 *                                 solid brand background (#0369b4) so the
 *                                 safe zone of the maskable spec is respected
 *   - apple-touch-icon.png        180x180 full-bleed for iOS Safari
 *
 * Usage: npm run icons:generate
 */
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT_DIR = path.resolve("public/icons");

const BRAND_BACKGROUND = "#0369b4";
const MASKABLE_SIZE = 512;
/** Logo occupies ~68% of the maskable canvas (within the 80% safe zone). */
const MASKABLE_LOGO_RATIO = 0.68;
const APPLE_TOUCH_SIZE = 180;
const ANY_ICON_SIZES = [192, 512];

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveSource() {
  const candidates = [
    path.resolve("public/logo.png"),
    path.resolve("public/icons/icon.svg"),
  ];
  return candidates.find((candidate) => exists(candidate));
}

async function writePng(instance, fileName, label) {
  await instance.png().toFile(path.join(OUT_DIR, fileName));
  console.log(`✓ public/icons/${fileName}${label ? ` (${label})` : ""}`);
}

async function main() {
  const source = resolveSource();
  if (!source) {
    throw new Error(
      "No se encontró el logo de origen: public/logo.png o public/icons/icon.svg",
    );
  }
  console.log(`Fuente: ${path.relative(".", source)}`);

  await mkdir(OUT_DIR, { recursive: true });

  for (const size of ANY_ICON_SIZES) {
    await writePng(
      sharp(source).resize(size, size, { fit: "cover" }),
      `icon-${size}x${size}.png`,
      `purpose any ${size}x${size}`,
    );
  }

  // Maskable: logo centered on the solid brand background.
  const logoSize = Math.round(MASKABLE_SIZE * MASKABLE_LOGO_RATIO);
  const logoBuffer = await sharp(source)
    .resize(logoSize, logoSize, { fit: "cover" })
    .png()
    .toBuffer();
  const offset = Math.round((MASKABLE_SIZE - logoSize) / 2);
  await writePng(
    sharp({
      create: {
        width: MASKABLE_SIZE,
        height: MASKABLE_SIZE,
        channels: 3,
        background: BRAND_BACKGROUND,
      },
    }).composite([{ input: logoBuffer, left: offset, top: offset }]),
    "icon-maskable-512x512.png",
    "purpose maskable 512x512",
  );

  await writePng(
    sharp(source).resize(APPLE_TOUCH_SIZE, APPLE_TOUCH_SIZE, { fit: "cover" }),
    "apple-touch-icon.png",
    "iOS 180x180",
  );

  console.log("Listo ✓");
}

main().catch((error) => {
  console.error(`[icons:generate] ${error.message}`);
  process.exitCode = 1;
});