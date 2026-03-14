/**
 * Office Layers — Background/foreground image loading
 * Adapted from pixel-agent-desk office-layers.js
 */

export function loadOfficeImage(src) {
  return new Promise(function (resolve) {
    const img = new Image()
    img.onload = function () { resolve(img) }
    img.onerror = function () {
      console.warn('[OfficeLayers] Failed to load:', src)
      const blank = new Image()
      blank.width = 800
      blank.height = 800
      resolve(blank)
    }
    img.src = src
  })
}

export const officeLayers = {
  bgImage: null,
  fgImage: null,
  width: 0,
  height: 0,
}

export async function buildOfficeLayers() {
  const ts = Date.now()
  const bgImg = await loadOfficeImage('/office/map/office_bg_32.webp?t=' + ts)
  const fgImg = await loadOfficeImage('/office/map/office_fg_32.webp?t=' + ts)

  officeLayers.bgImage = bgImg
  officeLayers.fgImage = fgImg
  officeLayers.width = bgImg.naturalWidth || 800
  officeLayers.height = bgImg.naturalHeight || 800

  return officeLayers
}
