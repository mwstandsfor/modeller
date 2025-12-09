/**
 * Perspective correction / dewarp utilities
 * Implements "Guided Upright" style correction (like Lightroom)
 *
 * User draws:
 * - 2 lines that SHOULD BE horizontal (x1, x2)
 * - 2 lines that SHOULD BE vertical (y1, y2)
 *
 * Algorithm computes a homography to straighten these lines
 * and applies it to the entire image.
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

  if (Math.abs(denom) < 0.0001) {
    return null; // Parallel
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;

  return {
    x: x1 + t * (x2 - x1),
    y: y1 + t * (y2 - y1)
  };
}

/**
 * Get the angle of a line in radians (-PI to PI)
 */
export function lineAngle(line) {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  return Math.atan2(dy, dx);
}

/**
 * Normalize angle to be close to a target
 */
function normalizeAngleNear(angle, target) {
  while (angle - target > Math.PI) angle -= 2 * Math.PI;
  while (angle - target < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

/**
 * Calculate perspective correction using 4 guide lines
 *
 * @param {object} lines - Object with x1, x2 (horizontal), y1, y2 (vertical) lines
 * @param {HTMLImageElement} img - Source image
 * @param {number} canvasWidth - Canvas width where lines were drawn
 * @param {number} canvasHeight - Canvas height where lines were drawn
 * @returns {Promise<{canvas: HTMLCanvasElement, width: number, height: number}>}
 */
export async function perspectiveTransform(lines, img, canvasWidth, canvasHeight) {
  // Scale line coordinates to image space
  const scaleX = img.width / canvasWidth;
  const scaleY = img.height / canvasHeight;

  const scaleLine = (line) => ({
    start: { x: line.start.x * scaleX, y: line.start.y * scaleY },
    end: { x: line.end.x * scaleX, y: line.end.y * scaleY }
  });

  const x1 = scaleLine(lines.x1);
  const x2 = scaleLine(lines.x2);
  const y1 = scaleLine(lines.y1);
  const y2 = scaleLine(lines.y2);

  // Get angles of the guide lines
  const xAngle1 = lineAngle(x1);
  const xAngle2 = normalizeAngleNear(lineAngle(x2), xAngle1);
  const avgXAngle = (xAngle1 + xAngle2) / 2;

  // For Y lines, normalize around -PI/2 (pointing up)
  const yAngle1 = normalizeAngleNear(lineAngle(y1), -Math.PI / 2);
  const yAngle2 = normalizeAngleNear(lineAngle(y2), yAngle1);
  const avgYAngle = (yAngle1 + yAngle2) / 2;

  console.log('X line angles:', xAngle1 * 180 / Math.PI, xAngle2 * 180 / Math.PI, '→ avg:', avgXAngle * 180 / Math.PI);
  console.log('Y line angles:', yAngle1 * 180 / Math.PI, yAngle2 * 180 / Math.PI, '→ avg:', avgYAngle * 180 / Math.PI);

  // Compute vanishing points
  const vpX = lineIntersection(x1, x2);
  const vpY = lineIntersection(y1, y2);

  console.log('Vanishing point X:', vpX);
  console.log('Vanishing point Y:', vpY);

  // Determine correction parameters
  // Rotation: make X lines horizontal
  const rotation = -avgXAngle;

  // After rotation, Y lines will be at angle (avgYAngle + rotation)
  // We want them at -PI/2 (vertical, pointing up)
  const yAngleAfterRotation = avgYAngle + rotation;
  const verticalDeviation = yAngleAfterRotation - (-Math.PI / 2);

  console.log('Rotation:', rotation * 180 / Math.PI, 'degrees');
  console.log('Y angle after rotation:', yAngleAfterRotation * 180 / Math.PI, 'degrees');
  console.log('Vertical deviation:', verticalDeviation * 180 / Math.PI, 'degrees');

  // For perspective correction (keystone), we use the vanishing point
  // The further the VP from the image center, the less perspective distortion
  let keystoneStrength = 0;

  if (vpY && Math.abs(verticalDeviation) > 0.01) {
    // Use vanishing point to determine keystone correction
    const imgCenterY = img.height / 2;
    const vpDistance = vpY.y - imgCenterY;

    // Negative vpDistance means VP is above image (lines converge upward)
    // Positive means VP is below (lines converge downward)
    if (Math.abs(vpDistance) > 10) {
      // The keystone factor determines how much horizontal shift per vertical position
      // This is derived from the vanishing point position
      keystoneStrength = -verticalDeviation * 0.7; // Empirical factor
    }
  }

  console.log('Keystone strength:', keystoneStrength);

  // Build the transformation matrix
  // We'll compute the transformed corners to determine output size
  const corners = [
    { x: 0, y: 0 },
    { x: img.width, y: 0 },
    { x: img.width, y: img.height },
    { x: 0, y: img.height }
  ];

  const centerX = img.width / 2;
  const centerY = img.height / 2;

  // Transform function
  const transform = (p) => {
    // Translate to center
    let x = p.x - centerX;
    let y = p.y - centerY;

    // Apply rotation
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;

    // Apply keystone (horizontal shear based on vertical position)
    const kx = rx + ry * keystoneStrength;
    const ky = ry;

    return { x: kx, y: ky };
  };

  // Transform corners
  const transformedCorners = corners.map(transform);

  // Find bounds
  const xs = transformedCorners.map(c => c.x);
  const ys = transformedCorners.map(c => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const outWidth = Math.ceil(maxX - minX);
  const outHeight = Math.ceil(maxY - minY);

  // Limit size
  const maxDim = 4096;
  let outputScale = 1;
  if (outWidth > maxDim || outHeight > maxDim) {
    outputScale = maxDim / Math.max(outWidth, outHeight);
  }

  const finalWidth = Math.ceil(outWidth * outputScale);
  const finalHeight = Math.ceil(outHeight * outputScale);

  // Create output canvas
  const canvas = document.createElement('canvas');
  canvas.width = finalWidth;
  canvas.height = finalHeight;
  const ctx = canvas.getContext('2d');

  // Get source image data
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = img.width;
  srcCanvas.height = img.height;
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.drawImage(img, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, img.width, img.height);

  // Create output image data
  const imageData = ctx.createImageData(finalWidth, finalHeight);

  // Inverse transform function (from output to source)
  const invCos = Math.cos(-rotation);
  const invSin = Math.sin(-rotation);

  for (let outY = 0; outY < finalHeight; outY++) {
    for (let outX = 0; outX < finalWidth; outX++) {
      // Convert to centered coordinates
      const tx = (outX / outputScale) + minX;
      const ty = (outY / outputScale) + minY;

      // Inverse keystone
      const ikx = tx - ty * keystoneStrength;
      const iky = ty;

      // Inverse rotation
      const sx = ikx * invCos - iky * invSin + centerX;
      const sy = ikx * invSin + iky * invCos + centerY;

      // Sample from source with bilinear interpolation
      if (sx >= 0 && sx < img.width - 1 && sy >= 0 && sy < img.height - 1) {
        const sx0 = Math.floor(sx);
        const sy0 = Math.floor(sy);
        const fx = sx - sx0;
        const fy = sy - sy0;

        const idx = (outY * finalWidth + outX) * 4;

        for (let c = 0; c < 4; c++) {
          const i00 = (sy0 * img.width + sx0) * 4 + c;
          const i10 = (sy0 * img.width + sx0 + 1) * 4 + c;
          const i01 = ((sy0 + 1) * img.width + sx0) * 4 + c;
          const i11 = ((sy0 + 1) * img.width + sx0 + 1) * 4 + c;

          const v = srcData.data[i00] * (1 - fx) * (1 - fy) +
                   srcData.data[i10] * fx * (1 - fy) +
                   srcData.data[i01] * (1 - fx) * fy +
                   srcData.data[i11] * fx * fy;

          imageData.data[idx + c] = Math.round(v);
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);

  return {
    canvas,
    width: finalWidth,
    height: finalHeight
  };
}

/**
 * Legacy function for backward compatibility
 */
export function calculateCorrection(xLine, yLine, imageWidth, imageHeight) {
  const xAngle = lineAngle(xLine);
  const yAngle = lineAngle(yLine);
  const xDeviation = xAngle;
  const yDeviation = yAngle - (-Math.PI / 2);
  const angleBetween = Math.abs(yAngle - xAngle);
  const angleFromPerpendicular = Math.abs(angleBetween - Math.PI / 2);

  return {
    xAngle,
    yAngle,
    xDeviation,
    yDeviation,
    angleFromPerpendicular,
    rotation: -xDeviation,
    shearX: Math.tan(yDeviation) * 0.5,
    shearY: 0,
    scaleX: 1,
    scaleY: 1 / Math.cos(angleFromPerpendicular * 0.5)
  };
}
