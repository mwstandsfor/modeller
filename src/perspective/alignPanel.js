/**
 * AlignmentPanel - Split view panel for perspective correction
 * Left panel shows source image with 4-corner selection
 * Right panel (3D viewport) shows live preview of rectified result
 * Supports zoom/pan via mouse wheel, pinch gestures, and drag
 */
export class AlignmentPanel {
  constructor() {
    // DOM Elements
    this.app = document.getElementById('app');
    this.panel = document.getElementById('align-panel');
    this.canvas = document.getElementById('align-canvas');
    this.ctx = this.canvas.getContext('2d');

    // UI Elements
    this.pointCounter = document.getElementById('align-point-count');
    this.ratioSlider = document.getElementById('align-ratio-slider');
    this.ratioValue = document.getElementById('align-ratio-value');
    this.btnClear = document.getElementById('align-clear');
    this.btnSkip = document.getElementById('align-skip');
    this.btnConfirm = document.getElementById('align-confirm');
    this.btnResetView = document.getElementById('align-reset-view');

    // State
    this.image = null;
    this.points = [];
    this.isDragging = false;
    this.dragIndex = -1;
    this.hoverIndex = -1;
    this.ratioScale = 1.0;

    // Zoom/Pan state
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.lastPanPoint = null;
    this.minScale = 0.5;
    this.maxScale = 2.0;

    // Touch gesture state
    this.touches = [];
    this.initialPinchDistance = null;
    this.initialScale = 1.0;

    // Pointer state for tap vs drag detection
    this.pointerStartPos = null;
    this.pointerStartImagePos = null;
    this.didMove = false;

    // Hit detection
    this.HIT_RADIUS = 20;

    // Colors
    this.colors = {
      line: '#949DFF',
      point: '#949DFF',
      pointHover: '#949DFF',
      pointDrag: '#bac4e9ff',
      guide: 'rgba(148, 157, 255, 0.3)'
    };

    // Callbacks
    this.onPointsChange = null;  // Called when points change (for live preview)
    this.onConfirm = null;       // Called when user confirms
    this.onSkip = null;          // Called when user skips

    // Bind methods
    this.handleResize = this.handleResize.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handleRatioChange = this.handleRatioChange.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleTouchMove = this.handleTouchMove.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);
  }

  /**
   * Activate the alignment panel with an image
   * @param {HTMLImageElement} image - The image to align
   */
  activate(image) {
    this.image = image;
    this.points = [];
    this.ratioScale = 1.0;
    this.ratioSlider.value = 1.0;
    this.ratioValue.textContent = '1.00';

    // Reset zoom/pan state
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.lastPanPoint = null;

    // Enter split mode
    this.app.classList.add('split-mode');

    // Setup canvas
    this.fitCanvasToImage();

    // Add pointer event listeners (for mouse and single touch)
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointerleave', this.handlePointerUp);

    // Mouse wheel zoom
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });

    // Touch events for pinch-to-zoom (need raw touch events for multi-touch)
    this.canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.handleTouchEnd);
    this.canvas.addEventListener('touchcancel', this.handleTouchEnd);

    this.ratioSlider.addEventListener('input', this.handleRatioChange);

    this.btnResetView.addEventListener('click', () => this.resetView());
    this.btnClear.addEventListener('click', () => this.clearPoints());
    this.btnSkip.addEventListener('click', () => this.skip());
    this.btnConfirm.addEventListener('click', () => this.confirm());

    window.addEventListener('resize', this.handleResize);

    // Update UI
    this.updateUI();
    this.draw();

    // Trigger resize for the 3D scene to update to split viewport size
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }

  /**
   * Deactivate the alignment panel
   */
  deactivate() {
    // Exit split mode
    this.app.classList.remove('split-mode');

    // Remove event listeners
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointerleave', this.handlePointerUp);

    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('touchstart', this.handleTouchStart);
    this.canvas.removeEventListener('touchmove', this.handleTouchMove);
    this.canvas.removeEventListener('touchend', this.handleTouchEnd);
    this.canvas.removeEventListener('touchcancel', this.handleTouchEnd);

    this.ratioSlider.removeEventListener('input', this.handleRatioChange);

    window.removeEventListener('resize', this.handleResize);

    // Clear state
    this.image = null;
    this.points = [];

    // Trigger resize for the 3D scene to update to new viewport size
    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }

  /**
   * Setup canvas to fill the panel content area
   */
  fitCanvasToImage() {
    if (!this.image) return;

    const container = this.panel.querySelector('.panel-content');
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // Set canvas to fill container (use device pixel ratio for crisp rendering)
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = containerWidth * dpr;
    this.canvas.height = containerHeight * dpr;
    this.canvas.style.width = `${containerWidth}px`;
    this.canvas.style.height = `${containerHeight}px`;

    // Scale context for device pixel ratio
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Calculate initial scale to fit image within canvas with padding
    const padding = 40;
    const availWidth = containerWidth - padding;
    const availHeight = containerHeight - padding;

    const imgRatio = this.image.width / this.image.height;
    const containerRatio = availWidth / availHeight;

    if (containerRatio > imgRatio) {
      this.baseScale = availHeight / this.image.height;
    } else {
      this.baseScale = availWidth / this.image.width;
    }

    // Store container dimensions for coordinate transforms
    this.containerWidth = containerWidth;
    this.containerHeight = containerHeight;
  }

  handleResize() {
    this.fitCanvasToImage();
    this.draw();
  }

  /**
   * Get image coordinates from screen coordinates (accounting for zoom/pan)
   */
  getPoint(e) {
    const rect = this.canvas.getBoundingClientRect();

    // Screen position relative to canvas element (in CSS pixels)
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Convert to image coordinates (accounting for zoom/pan)
    return this.screenToImage(screenX, screenY);
  }

  /**
   * Convert screen coordinates (relative to canvas element) to image coordinates
   */
  screenToImage(screenX, screenY) {
    // Center of container
    const centerX = this.containerWidth / 2;
    const centerY = this.containerHeight / 2;

    // Combined scale (base fit + user zoom)
    const totalScale = this.baseScale * this.scale;

    // Apply inverse transform: screen -> image
    // Transform is: translate(center + pan), scale(totalScale), translate(-imgCenter)
    const imgCenterX = this.image.width / 2;
    const imgCenterY = this.image.height / 2;

    const imageX = (screenX - centerX - this.panX) / totalScale + imgCenterX;
    const imageY = (screenY - centerY - this.panY) / totalScale + imgCenterY;

    return { x: imageX, y: imageY };
  }

  /**
   * Convert image coordinates to screen coordinates (relative to canvas element)
   */
  imageToScreen(imageX, imageY) {
    // Center of container
    const centerX = this.containerWidth / 2;
    const centerY = this.containerHeight / 2;

    // Combined scale (base fit + user zoom)
    const totalScale = this.baseScale * this.scale;

    // Image center
    const imgCenterX = this.image.width / 2;
    const imgCenterY = this.image.height / 2;

    // Apply transform: image -> screen
    const screenX = (imageX - imgCenterX) * totalScale + centerX + this.panX;
    const screenY = (imageY - imgCenterY) * totalScale + centerY + this.panY;

    return { x: screenX, y: screenY };
  }

  /**
   * Get client coordinates from touch
   */
  getTouchCenter(touches) {
    if (touches.length === 1) {
      return { x: touches[0].clientX, y: touches[0].clientY };
    }
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2
    };
  }

  /**
   * Get distance between two touches
   */
  getTouchDistance(touches) {
    if (touches.length < 2) return 0;
    const dx = touches[1].clientX - touches[0].clientX;
    const dy = touches[1].clientY - touches[0].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Zoom at a specific point (keeps that point stationary)
   * @param {number} screenX - Screen X relative to canvas element (CSS pixels)
   * @param {number} screenY - Screen Y relative to canvas element (CSS pixels)
   * @param {number} newScale - New zoom scale (user zoom, not including baseScale)
   */
  zoomAt(screenX, screenY, newScale) {
    // Clamp scale
    newScale = Math.max(this.minScale, Math.min(this.maxScale, newScale));

    // Get the image point under cursor before zoom change
    const imgPoint = this.screenToImage(screenX, screenY);

    // Update scale
    this.scale = newScale;

    // Calculate where that image point would now appear on screen
    const newScreenPos = this.imageToScreen(imgPoint.x, imgPoint.y);

    // Adjust pan to keep the point stationary
    this.panX += screenX - newScreenPos.x;
    this.panY += screenY - newScreenPos.y;

    this.draw();
  }

  /**
   * Handle mouse wheel for zoom
   */
  handleWheel(e) {
    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Calculate new scale
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = this.scale * zoomFactor;

    this.zoomAt(screenX, screenY, newScale);
  }

  /**
   * Handle touch start for pinch-to-zoom
   */
  handleTouchStart(e) {
    this.touches = Array.from(e.touches);

    if (this.touches.length === 2) {
      // Start pinch gesture
      e.preventDefault();
      this.initialPinchDistance = this.getTouchDistance(this.touches);
      this.initialScale = this.scale;
      this.isPanning = false;
    } else if (this.touches.length === 1) {
      // Could be either a tap to place point or start of pan
      // We'll determine in touchmove
      this.lastPanPoint = { x: this.touches[0].clientX, y: this.touches[0].clientY };
    }
  }

  /**
   * Handle touch move for pinch-to-zoom and pan
   */
  handleTouchMove(e) {
    this.touches = Array.from(e.touches);
    const rect = this.canvas.getBoundingClientRect();

    if (this.touches.length === 2 && this.initialPinchDistance) {
      // Pinch zoom
      e.preventDefault();

      const currentDistance = this.getTouchDistance(this.touches);
      const scaleFactor = currentDistance / this.initialPinchDistance;
      const newScale = this.initialScale * scaleFactor;

      const center = this.getTouchCenter(this.touches);
      const screenX = center.x - rect.left;
      const screenY = center.y - rect.top;

      this.zoomAt(screenX, screenY, newScale);
    } else if (this.touches.length === 1 && this.lastPanPoint && !this.isDragging) {
      // Pan with single finger (if not dragging a point)
      const dx = this.touches[0].clientX - this.lastPanPoint.x;
      const dy = this.touches[0].clientY - this.lastPanPoint.y;

      // Only start panning if movement is significant
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5 || this.isPanning) {
        e.preventDefault();
        this.isPanning = true;

        // Pan is in screen coordinates (CSS pixels)
        this.panX += dx;
        this.panY += dy;

        this.lastPanPoint = { x: this.touches[0].clientX, y: this.touches[0].clientY };
        this.draw();
      }
    }
  }

  /**
   * Handle touch end
   */
  handleTouchEnd(e) {
    // If we were pinching and now have fewer than 2 touches, reset pinch state
    if (this.initialPinchDistance && e.touches.length < 2) {
      this.initialPinchDistance = null;
      this.initialScale = this.scale;
    }

    // If we were panning with single touch and it ended without significant movement, treat as tap
    if (this.touches.length === 1 && e.touches.length === 0 && !this.isPanning) {
      // Let pointer events handle the tap
    }

    this.touches = Array.from(e.touches);
    this.isPanning = false;
    this.lastPanPoint = null;
  }

  /**
   * Find point at position (in image coordinates)
   */
  getPointAt(pos) {
    // Hit radius is 25px in screen space, convert to image space
    const totalScale = this.baseScale * this.scale;
    const hitRadius = 25 / totalScale;

    for (let i = 0; i < this.points.length; i++) {
      const dist = Math.sqrt(
        Math.pow(pos.x - this.points[i].x, 2) +
        Math.pow(pos.y - this.points[i].y, 2)
      );
      if (dist < hitRadius) {
        return i;
      }
    }
    return -1;
  }

  handlePointerDown(e) {
    // Ignore if multi-touch (pinch gesture handled by touch events)
    if (e.pointerType === 'touch' && this.touches.length > 1) return;

    e.preventDefault();
    const pos = this.getPoint(e);
    const index = this.getPointAt(pos);

    // Record start position for tap detection
    this.pointerStartPos = { x: e.clientX, y: e.clientY };
    this.pointerStartImagePos = pos;
    this.didMove = false;

    if (index !== -1) {
      // Start dragging existing point
      this.isDragging = true;
      this.dragIndex = index;
    } else {
      // Potential tap to add point, or pan - we'll decide on pointerup
      this.isPanning = false;
    }
  }

  handlePointerMove(e) {
    const pos = this.getPoint(e);

    if (this.isDragging && this.dragIndex !== -1) {
      // Dragging a point
      this.points[this.dragIndex] = pos;
      this.draw();
    } else if (this.pointerStartPos) {
      // Check if we've moved enough to start panning
      const dx = e.clientX - this.pointerStartPos.x;
      const dy = e.clientY - this.pointerStartPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 10) {
        this.didMove = true;

        if (!this.isPanning) {
          this.isPanning = true;
          this.lastPanPoint = { x: e.clientX, y: e.clientY };
        } else {
          // Continue panning - pan is in screen coordinates (CSS pixels)
          const panDx = e.clientX - this.lastPanPoint.x;
          const panDy = e.clientY - this.lastPanPoint.y;
          this.panX += panDx;
          this.panY += panDy;

          this.lastPanPoint = { x: e.clientX, y: e.clientY };
          this.draw();
        }
      }
    } else {
      // Just hovering - update hover state
      const newHoverIndex = this.getPointAt(pos);
      if (newHoverIndex !== this.hoverIndex) {
        this.hoverIndex = newHoverIndex;
        this.updateCursor();
        this.draw();
      }
    }
  }

  handlePointerUp(e) {
    if (this.isDragging) {
      this.isDragging = false;
      this.dragIndex = -1;

      if (this.points.length === 4) {
        this.notifyPointsChange();
      }
    } else if (!this.didMove && this.pointerStartImagePos && this.points.length < 4) {
      // This was a tap - add a new point at the start position
      this.points.push(this.pointerStartImagePos);
      this.updateUI();
      this.draw();

      if (this.points.length === 4) {
        this.notifyPointsChange();
      }
    }

    // Reset state
    this.isPanning = false;
    this.pointerStartPos = null;
    this.pointerStartImagePos = null;
    this.didMove = false;
    this.lastPanPoint = null;
  }

  handleRatioChange(e) {
    this.ratioScale = parseFloat(e.target.value);
    this.ratioValue.textContent = this.ratioScale.toFixed(2);

    if (this.points.length === 4) {
      this.notifyPointsChange();
    }
  }

  updateCursor() {
    if (this.hoverIndex !== -1) {
      this.canvas.style.cursor = 'move';
    } else if (this.points.length < 4) {
      this.canvas.style.cursor = 'crosshair';
    } else {
      this.canvas.style.cursor = 'default';
    }
  }

  updateUI() {
    this.pointCounter.textContent = this.points.length;
    this.btnConfirm.disabled = this.points.length < 4;
    this.updateCursor();
  }

  /**
   * Sort points to consistent order: [TL, TR, BR, BL]
   */
  sortPoints(pts) {
    if (pts.length !== 4) return pts;

    const sortedByY = [...pts].sort((a, b) => a.y - b.y);
    const top = sortedByY.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = sortedByY.slice(2, 4).sort((a, b) => a.x - b.x);

    return [top[0], top[1], bottom[1], bottom[0]];
  }

  /**
   * Get sorted points
   */
  getPoints() {
    return this.sortPoints(this.points);
  }

  /**
   * Notify that points changed (for live preview)
   */
  notifyPointsChange() {
    if (this.onPointsChange && this.points.length === 4) {
      this.onPointsChange({
        points: this.getPoints(),
        ratioScale: this.ratioScale,
        image: this.image
      });
    }
  }

  /**
   * Clear all points
   */
  clearPoints() {
    this.points = [];
    this.updateUI();
    this.draw();
  }

  /**
   * Skip alignment
   */
  skip() {
    if (this.onSkip) {
      this.onSkip();
    }
    this.deactivate();
  }

  /**
   * Confirm alignment
   */
  confirm() {
    if (this.points.length < 4) return;

    if (this.onConfirm) {
      this.onConfirm({
        points: this.getPoints(),
        ratioScale: this.ratioScale,
        image: this.image
      });
    }
    this.deactivate();
  }

  /**
   * Draw the canvas with zoom/pan transforms
   */
  draw() {
    if (!this.image || !this.containerWidth) return;

    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;

    // Clear canvas (using CSS pixel dimensions)
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.containerWidth, this.containerHeight);

    // Combined scale
    const totalScale = this.baseScale * this.scale;

    // Center of container
    const centerX = this.containerWidth / 2;
    const centerY = this.containerHeight / 2;

    // Image center
    const imgCenterX = this.image.width / 2;
    const imgCenterY = this.image.height / 2;

    // Apply transforms: translate to center + pan, scale, translate by -imageCenter
    ctx.translate(centerX + this.panX, centerY + this.panY);
    ctx.scale(totalScale, totalScale);
    ctx.translate(-imgCenterX, -imgCenterY);

    // Draw image at origin (transforms handle positioning)
    ctx.drawImage(this.image, 0, 0);

    // Draw guide lines (center cross) on the image
    ctx.strokeStyle = this.colors.guide;
    ctx.lineWidth = 1 / totalScale;
    ctx.setLineDash([10 / totalScale, 10 / totalScale]);

    // Vertical center of image
    ctx.beginPath();
    ctx.moveTo(imgCenterX, 0);
    ctx.lineTo(imgCenterX, this.image.height);
    ctx.stroke();

    // Horizontal center of image
    ctx.beginPath();
    ctx.moveTo(0, imgCenterY);
    ctx.lineTo(this.image.width, imgCenterY);
    ctx.stroke();

    ctx.setLineDash([]);

    // Draw connecting lines between points
    if (this.points.length > 0) {
      const lineWidth = 5 / totalScale;

      ctx.beginPath();
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = this.colors.line;
      ctx.moveTo(this.points[0].x, this.points[0].y);

      for (let i = 1; i < this.points.length; i++) {
        ctx.lineTo(this.points[i].x, this.points[i].y);
      }

      if (this.points.length === 4) {
        ctx.closePath();
      }
      ctx.stroke();
    }

    // Draw corner points - LARGE markers for easy visibility
    // 20px radius in screen space, converted to image space
    const markerRadius = 10 / totalScale;
    const borderWidth = 6 / totalScale;
    const fontSize = 14 / totalScale;

    this.points.forEach((p, i) => {
      // Outer ring for better visibility
      ctx.beginPath();
      ctx.arc(p.x, p.y, markerRadius + borderWidth * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(30, 34, 76, 0.4)';
      ctx.fill();

      // Main marker
      ctx.beginPath();
      ctx.arc(p.x, p.y, markerRadius, 0, Math.PI * 2);

      // Color based on state
      if (i === this.dragIndex) {
        ctx.fillStyle = this.colors.pointDrag;
      } else if (i === this.hoverIndex) {
        ctx.fillStyle = this.colors.pointHover;
      } else {
        ctx.fillStyle = this.colors.point;
      }
      ctx.fill();

      // innerBorder
    //   ctx.lineWidth = borderWidth;
    //  ctx.strokeStyle = this.colors.line;
    //  ctx.stroke();

      // Point number
      ctx.fillStyle = 'rgba(30, 34, 76, 0.85)';
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((i + 1).toString(), p.x, p.y + fontSize * 0.05);  // <-- Lower by ~20% of font size
    });

    ctx.restore();

    // Draw zoom indicator (outside of image transform, but with DPR)
    if (this.scale !== 1.0) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.fillRect(12, 8, 70, 28);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(this.scale * 100)}%`, 24, 24);
      ctx.restore();
    }
  }

  /**
   * Reset zoom and pan to default
   */
  resetView() {
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.draw();
  }
}
