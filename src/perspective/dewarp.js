/**
 * Perspective Rectification using OpenCV.js
 *
 * INPUT: 4 corner points defining a perspective quad
 * OUTPUT: Full image warped so the quad becomes a rectangle
 *
 * Uses OpenCV's getPerspectiveTransform and warpPerspective
 */

/**
 * Check if OpenCV is loaded
 */
export function isOpenCVReady() {
  return typeof cv !== 'undefined' && cv.Mat;
}

/**
 * Wait for OpenCV to load
 */
export function waitForOpenCV(timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (isOpenCVReady()) {
      resolve();
      return;
    }

    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (isOpenCVReady()) {
        clearInterval(checkInterval);
        resolve();
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error('OpenCV.js failed to load'));
      }
    }, 100);
  });
}

/**
 * Calculate distance between two points
 */
function distance(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

/**
 * Sort points to consistent order: [TL, TR, BR, BL]
 */
function sortPoints(pts) {
  const sortedByY = [...pts].sort((a, b) => a.y - b.y);
  const top = sortedByY.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sortedByY.slice(2, 4).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

/**
 * Main perspective transform function using OpenCV
 *
 * @param {Array} points - 4 corner points [{x, y}, ...] in order [TL, TR, BR, BL]
 * @param {HTMLImageElement} img - Source image
 * @param {number} canvasWidth - Overlay canvas width
 * @param {number} canvasHeight - Overlay canvas height
 * @param {number} ratioScale - Scale factor for output height (default 1.0)
 * @returns {Object} - { canvas, width, height }
 */
export async function perspectiveTransform(points, img, canvasWidth, canvasHeight, ratioScale = 1.0) {
  // Ensure OpenCV is loaded
  if (!isOpenCVReady()) {
    console.warn('OpenCV not ready, using fallback');
    return fallbackCorrection(img);
  }

  // Scale points from canvas coordinates to image coordinates
  const scaleX = img.width / canvasWidth;
  const scaleY = img.height / canvasHeight;

  const sorted = sortPoints(points.map(p => ({
    x: p.x * scaleX,
    y: p.y * scaleY
  })));

  console.log('Sorted points (image coords):', sorted);

  // Calculate baseline dimensions from the quad
  const widthTop = distance(sorted[0], sorted[1]);
  const widthBottom = distance(sorted[3], sorted[2]);
  const maxWidth = Math.max(widthTop, widthBottom);

  const heightLeft = distance(sorted[0], sorted[3]);
  const heightRight = distance(sorted[1], sorted[2]);

  // Apply ratio scale to height
  const targetHeight = Math.max(heightLeft, heightRight) * ratioScale;

  console.log('Dimensions - Width:', maxWidth, 'Height:', targetHeight, 'Ratio:', ratioScale);

  try {
    // Create clean canvas for source (without UI overlays)
    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = img.width;
    cleanCanvas.height = img.height;
    const cleanCtx = cleanCanvas.getContext('2d');
    cleanCtx.drawImage(img, 0, 0);

    // Read image into OpenCV
    let src = cv.imread(cleanCanvas);

    // Define source quad (the 4 points user selected)
    let srcQuad = cv.matFromArray(4, 1, cv.CV_32FC2, [
      sorted[0].x, sorted[0].y,
      sorted[1].x, sorted[1].y,
      sorted[2].x, sorted[2].y,
      sorted[3].x, sorted[3].y
    ]);

    // Define destination quad (rectangle with scaled height)
    let dstQuad = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      maxWidth, 0,
      maxWidth, targetHeight,
      0, targetHeight
    ]);

    // Compute the perspective transform matrix
    let M = cv.getPerspectiveTransform(srcQuad, dstQuad);

    // Transform the full image corners to find output bounds
    let imageCorners = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      src.cols, 0,
      src.cols, src.rows,
      0, src.rows
    ]);

    let warpedCorners = new cv.Mat();
    cv.perspectiveTransform(imageCorners, warpedCorners, M);

    // Find bounding box of warped full image
    let min_x = Infinity, min_y = Infinity;
    let max_x = -Infinity, max_y = -Infinity;

    for (let i = 0; i < 4; i++) {
      const x = warpedCorners.data32F[i * 2];
      const y = warpedCorners.data32F[i * 2 + 1];
      min_x = Math.min(min_x, x);
      min_y = Math.min(min_y, y);
      max_x = Math.max(max_x, x);
      max_y = Math.max(max_y, y);
    }

    let finalWidth = Math.round(max_x - min_x);
    let finalHeight = Math.round(max_y - min_y);

    console.log('Output bounds:', min_x, min_y, 'to', max_x, max_y);
    console.log('Final size:', finalWidth, 'x', finalHeight);

    // Safety cap to prevent browser crash
    const MAX_DIM = 5000;
    if (finalWidth > MAX_DIM || finalHeight > MAX_DIM) {
      console.warn('Output too large, scaling down');
      const scaleFactor = Math.min(1, MAX_DIM / finalWidth, MAX_DIM / finalHeight);
      finalWidth = Math.round(finalWidth * scaleFactor);
      finalHeight = Math.round(finalHeight * scaleFactor);
    }

    // Create translation matrix to shift output to positive coordinates
    let translationMatrix = cv.matFromArray(3, 3, cv.CV_64F, [
      1, 0, -min_x,
      0, 1, -min_y,
      0, 0, 1
    ]);

    // Combine translation with perspective transform
    let M_final = new cv.Mat();
    cv.gemm(translationMatrix, M, 1, new cv.Mat(), 0, M_final);

    // Warp the full image
    let dst = new cv.Mat();
    let dsize = new cv.Size(finalWidth, finalHeight);
    cv.warpPerspective(src, dst, M_final, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));

    // Convert result to standard canvas
    let outputCanvas = document.createElement('canvas');
    outputCanvas.width = finalWidth;
    outputCanvas.height = finalHeight;
    cv.imshow(outputCanvas, dst);

    // Cleanup OpenCV resources
    src.delete();
    dst.delete();
    M.delete();
    srcQuad.delete();
    dstQuad.delete();
    imageCorners.delete();
    warpedCorners.delete();
    translationMatrix.delete();
    M_final.delete();
    cleanCanvas.remove();

    return {
      canvas: outputCanvas,
      width: finalWidth,
      height: finalHeight
    };

  } catch (error) {
    console.error('OpenCV processing error:', error);
    return fallbackCorrection(img);
  }
}

/**
 * Fallback - return image unchanged
 */
function fallbackCorrection(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  return {
    canvas,
    width: canvas.width,
    height: canvas.height
  };
}

/**
 * Legacy exports for compatibility
 */
export function lineAngle(line) {
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  return Math.atan2(dy, dx);
}

export function lineIntersection(line1, line2) {
  const x1 = line1.start.x, y1 = line1.start.y;
  const x2 = line1.end.x, y2 = line1.end.y;
  const x3 = line2.start.x, y3 = line2.start.y;
  const x4 = line2.end.x, y4 = line2.end.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

  if (Math.abs(denom) < 0.0001) {
    return null;
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;

  return {
    x: x1 + t * (x2 - x1),
    y: y1 + t * (y2 - y1)
  };
}

export function calculateCorrection(xLine, yLine, imageWidth, imageHeight) {
  const xAngle = lineAngle(xLine);
  const yAngle = lineAngle(yLine);
  return {
    xAngle,
    yAngle,
    xDeviation: xAngle,
    yDeviation: yAngle - (-Math.PI / 2),
    rotation: -xAngle
  };
}
