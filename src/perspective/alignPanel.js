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
    this.maxScale = 5.0;

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
      point: '#E3E3E3',
      pointHover: '#949DFF',
      pointDrag: '#22c55e',
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
   * Fit canvas to image while maintaining aspect ratio
   */
  fitCanvasToImage() {
    if (!this.image) return;

    const container = this.panel.querySelector('.panel-content');
    const padding = 40;
    const maxWidth = container.clientWidth - padding;
    const maxHeight = container.clientHeight - padding;

    const imgRatio = this.image.width / this.image.height;
    const containerRatio = maxWidth / maxHeight;

    let displayWidth, displayHeight;

    if (containerRatio > imgRatio) {
      displayHeight = maxHeight;
      displayWidth = displayHeight * imgRatio;
    } else {
      displayWidth = maxWidth;
      displayHeight = displayWidth / imgRatio;
    }

    // Set canvas to image dimensions (for accurate point mapping)
    this.canvas.width = this.image.width;
    this.canvas.height = this.image.height;

    // Set display size
    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;
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

    // Screen position relative to canvas element
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Convert to image coordinates (accounting for zoom/pan)
    return this.screenToImage(screenX, screenY);
  }

  /**
   * Convert screen coordinates (relative to canvas element) to image coordinates
   */
  screenToImage(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();

    // First convert screen coords to canvas internal coords (accounting for CSS scaling)
    const cssScaleX = this.canvas.width / rect.width;
    const cssScaleY = this.canvas.height / rect.height;

    const canvasX = screenX * cssScaleX;
    const canvasY = screenY * cssScaleY;

    // Center of canvas in internal coords
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;

    // Apply inverse zoom/pan transform to get image coordinates
    // The draw transform is: translate(center + pan), scale, translate(-center)
    // Inverse is: translate(center), scale^-1, translate(-center - pan)
    const imageX = (canvasX - centerX - this.panX) / this.scale + centerX;
    const imageY = (canvasY - centerY - this.panY) / this.scale + centerY;

    return { x: imageX, y: imageY };
  }

  /**
   * Convert image coordinates to screen coordinates (relative to canvas element)
   */
  imageToScreen(imageX, imageY) {
    const rect = this.canvas.getBoundingClientRect();

    // Center of canvas in internal coords
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;

    // Apply zoom/pan transform
    const canvasX = (imageX - centerX) * this.scale + centerX + this.panX;
    const canvasY = (imageY - centerY) * this.scale + centerY + this.panY;

    // Convert canvas internal coords to screen coords
    const cssScaleX = rect.width / this.canvas.width;
    const cssScaleY = rect.height / this.canvas.height;

    return {
      x: canvasX * cssScaleX,
      y: canvasY * cssScaleY
    };
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
   * @param {number} screenX - Screen X relative to canvas element
   * @param {number} screenY - Screen Y relative to canvas element
   * @param {number} newScale - New zoom scale
   */
  zoomAt(screenX, screenY, newScale) {
    const rect = this.canvas.getBoundingClientRect();

    // Convert screen coords to canvas internal coords
    const cssScaleX = this.canvas.width / rect.width;
    const cssScaleY = this.canvas.height / rect.height;
    const canvasX = screenX * cssScaleX;
    const canvasY = screenY * cssScaleY;

    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;

    // Clamp scale
    newScale = Math.max(this.minScale, Math.min(this.maxScale, newScale));

    // Calculate the image point under the cursor before zoom
    const imgX = (canvasX - centerX - this.panX) / this.scale + centerX;
    const imgY = (canvasY - centerY - this.panY) / this.scale + centerY;

    // Update scale
    this.scale = newScale;

    // Calculate new pan to keep the same image point under the cursor
    this.panX = canvasX - centerX - (imgX - centerX) * this.scale;
    this.panY = canvasY - centerY - (imgY - centerY) * this.scale;

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

        // Convert screen delta to canvas internal coords
        const cssScaleX = this.canvas.width / rect.width;
        const cssScaleY = this.canvas.height / rect.height;
        this.panX += dx * cssScaleX;
        this.panY += dy * cssScaleY;

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
   * Find point at position
   */
  getPointAt(pos) {
    const scaledRadius = Math.max(this.HIT_RADIUS, this.canvas.width / 40);

    for (let i = 0; i < this.points.length; i++) {
      const dist = Math.sqrt(
        Math.pow(pos.x - this.points[i].x, 2) +
        Math.pow(pos.y - this.points[i].y, 2)
      );
      if (dist < scaledRadius) {
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
          // Continue panning
          const rect = this.canvas.getBoundingClientRect();
          const cssScaleX = this.canvas.width / rect.width;
          const cssScaleY = this.canvas.height / rect.height;

          const panDx = e.clientX - this.lastPanPoint.x;
          const panDy = e.clientY - this.lastPanPoint.y;
          this.panX += panDx * cssScaleX;
          this.panY += panDy * cssScaleY;

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
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, w, h);

    // Save context and apply zoom/pan transforms
    ctx.save();

    // Move origin to center, apply pan and scale, then move back
    ctx.translate(w / 2 + this.panX, h / 2 + this.panY);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-w / 2, -h / 2);

    // Draw image
    if (this.image) {
      ctx.drawImage(this.image, 0, 0);
    }

    // Draw guide lines (center cross)
    ctx.strokeStyle = this.colors.guide;
    ctx.lineWidth = 1 / this.scale; // Keep consistent visual width
    ctx.setLineDash([10 / this.scale, 10 / this.scale]);

    // Vertical center
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();

    // Horizontal center
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    ctx.setLineDash([]);

    // Draw connecting lines
    if (this.points.length > 0) {
      const lineWidth = Math.max(2, w / 300) / this.scale;

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

    // Draw corner points
    const radius = Math.max(8, w / 80) / this.scale;
    const lineWidth = Math.max(2, w / 300) / this.scale;

    this.points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);

      // Color based on state
      if (i === this.dragIndex) {
        ctx.fillStyle = this.colors.pointDrag;
      } else if (i === this.hoverIndex) {
        ctx.fillStyle = this.colors.pointHover;
      } else {
        ctx.fillStyle = this.colors.point;
      }

      ctx.fill();

      // Border
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.stroke();

      // Point number
      ctx.fillStyle = '#000';
      ctx.font = `bold ${Math.max(12, radius * this.scale) / this.scale}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((i + 1).toString(), p.x, p.y);
    });

    ctx.restore();

    // Draw zoom indicator (outside of transform)
    if (this.scale !== 1.0) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(10, 10, 70, 24);
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(this.scale * 100)}%`, 18, 22);
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
