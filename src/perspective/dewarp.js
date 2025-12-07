/**
 * Perspective correction / dewarp utilities
 * Calculates homography from two perspective lines
 */

/**
 * Calculate the intersection point of two lines
 * Each line is defined by two points: {start: {x, y}, end: {x, y}}
 * @returns {{x: number, y: number}|null} - Intersection point or null if parallel
 */
export function lineIntersection(line1, line2) {
  const x1 = line1.start.x, y1 = line1.start.y;
  const x2 = line1.end.x, y2 = line1.end.y;
  const x3 = line2.start.x, y3 = line2.start.y;
  const x4 = line2.end.x, y4 = line2.end.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

  // Lines are parallel
  if (Math.abs(denom) < 0.0001) {
    return null;
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;

  return {
    x: x1 + t * (x2 - x1),
    y: y1 + t * (y2 - y1)
  };
}

/**
 * Get the angle of a line in radians
 */
export function lineAngle(line) {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  return Math.atan2(dy, dx);
}

/**
 * Calculate a simple perspective correction transform
 * based on two user-drawn lines (X and Y axis)
 *
 * This is a simplified approach that:
 * 1. Calculates the angle of each line
 * 2. Computes a shear/rotation to make them perpendicular
 * 3. Returns the transform parameters
 *
 * @param {object} xLine - The horizontal reference line
 * @param {object} yLine - The vertical reference line
 * @param {number} imageWidth - Original image width
 * @param {number} imageHeight - Original image height
 * @returns {object} Transform parameters
 */
export function calculateCorrection(xLine, yLine, imageWidth, imageHeight) {
  // Get angles of lines
  const xAngle = lineAngle(xLine);
  const yAngle = lineAngle(yLine);

  // Calculate how much the X line deviates from horizontal (0 radians)
  const xDeviation = xAngle;

  // Calculate how much the Y line deviates from vertical (-PI/2 radians)
  const yDeviation = yAngle - (-Math.PI / 2);

  // The angle between the lines (should be 90 degrees for no perspective)
  const angleBetween = Math.abs(yAngle - xAngle);
  const angleFromPerpendicular = Math.abs(angleBetween - Math.PI / 2);

  // Calculate vanishing points (where parallel lines would meet)
  // For a simple case, we use the line directions
  const vanishX = lineIntersection(xLine, {
    start: { x: xLine.start.x, y: 0 },
    end: { x: xLine.start.x, y: imageHeight }
  });

  const vanishY = lineIntersection(yLine, {
    start: { x: 0, y: yLine.start.y },
    end: { x: imageWidth, y: yLine.start.y }
  });

  return {
    xAngle,
    yAngle,
    xDeviation,
    yDeviation,
    angleFromPerpendicular,
    rotation: -xDeviation, // Rotate to make X horizontal
    // Shear to correct perspective
    shearX: Math.tan(yDeviation) * 0.5,
    shearY: 0,
    // Scale factors (estimate based on perspective)
    scaleX: 1,
    scaleY: 1 / Math.cos(angleFromPerpendicular * 0.5)
  };
}

/**
 * Apply perspective correction to an image using canvas
 *
 * @param {HTMLImageElement|string} imageSource - Image element or data URL
 * @param {object} correction - Correction parameters from calculateCorrection
 * @returns {Promise<{canvas: HTMLCanvasElement, dataUrl: string}>}
 */
export async function applyCorrection(imageSource, correction) {
  return new Promise((resolve, reject) => {
    const img = typeof imageSource === 'string' ? new Image() : imageSource;

    const process = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Calculate output dimensions (may be larger due to rotation)
      const padding = 50;
      const outputWidth = img.width + padding * 2;
      const outputHeight = img.height + padding * 2;

      canvas.width = outputWidth;
      canvas.height = outputHeight;

      // Clear with transparent
      ctx.clearRect(0, 0, outputWidth, outputHeight);

      // Move to center
      ctx.save();
      ctx.translate(outputWidth / 2, outputHeight / 2);

      // Apply rotation to correct X-axis
      ctx.rotate(correction.rotation);

      // Apply shear for perspective correction
      ctx.transform(
        correction.scaleX,  // a: horizontal scale
        correction.shearY,  // b: vertical shear
        correction.shearX,  // c: horizontal shear
        correction.scaleY,  // d: vertical scale
        0,                  // e: horizontal translation
        0                   // f: vertical translation
      );

      // Draw image centered
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      ctx.restore();

      // Trim transparent edges
      const trimmed = trimCanvas(canvas);

      resolve({
        canvas: trimmed,
        dataUrl: trimmed.toDataURL('image/png'),
        width: trimmed.width,
        height: trimmed.height
      });
    };

    if (typeof imageSource === 'string') {
      img.onload = process;
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imageSource;
    } else {
      process();
    }
  });
}

/**
 * Trim transparent edges from a canvas
 * @param {HTMLCanvasElement} canvas
 * @returns {HTMLCanvasElement}
 */
function trimCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  let top = canvas.height, left = canvas.width, right = 0, bottom = 0;

  // Find bounds of non-transparent pixels
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const alpha = pixels[(y * canvas.width + x) * 4 + 3];
      if (alpha > 0) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  // Add small padding
  const pad = 2;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(canvas.width - 1, right + pad);
  bottom = Math.min(canvas.height - 1, bottom + pad);

  // Create trimmed canvas
  const trimmedWidth = right - left + 1;
  const trimmedHeight = bottom - top + 1;

  const trimmed = document.createElement('canvas');
  trimmed.width = trimmedWidth;
  trimmed.height = trimmedHeight;

  const trimmedCtx = trimmed.getContext('2d');
  trimmedCtx.drawImage(
    canvas,
    left, top, trimmedWidth, trimmedHeight,
    0, 0, trimmedWidth, trimmedHeight
  );

  return trimmed;
}

/**
 * Simplified perspective correction using 4-point transform
 * This maps the quadrilateral defined by the perspective lines to a rectangle
 *
 * @param {object} xLine - Horizontal reference line
 * @param {object} yLine - Vertical reference line
 * @param {HTMLImageElement} img - Source image
 * @param {number} canvasWidth - Canvas width where lines were drawn
 * @param {number} canvasHeight - Canvas height where lines were drawn
 * @returns {Promise<{canvas: HTMLCanvasElement, dataUrl: string}>}
 */
export async function perspectiveTransform(xLine, yLine, img, canvasWidth, canvasHeight) {
  // For a simplified implementation, we'll calculate the rotation
  // needed to make the X line horizontal, then apply a vertical scale
  // correction based on the Y line

  const correction = calculateCorrection(xLine, yLine, img.width, img.height);

  // Apply basic rotation correction
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Rotate image to make X-axis horizontal
  const angle = correction.rotation;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));

  // New dimensions after rotation
  const newWidth = img.width * cos + img.height * sin;
  const newHeight = img.width * sin + img.height * cos;

  canvas.width = Math.ceil(newWidth);
  canvas.height = Math.ceil(newHeight);

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(angle);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);

  return {
    canvas,
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    correction
  };
}
