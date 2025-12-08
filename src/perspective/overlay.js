/**
 * 2D Overlay for drawing perspective correction lines
 * This canvas sits on top of the 3D viewport during perspective mode
 */
export class PerspectiveOverlay {
  constructor(canvas, sceneManager) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sceneManager = sceneManager;

    // Line data
    this.lines = {
      x: null, // Horizontal perspective line
      y: null  // Vertical perspective line
    };

    // Current line being drawn
    this.currentLine = null;
    this.currentAxis = 'x'; // Start with x-axis

    // Drawing state
    this.isDrawing = false;
    this.startPoint = null;

    // Style
    this.colors = {
      x: '#ff6b6b', // Red for X-axis
      y: '#4ecdc4', // Teal for Y-axis
      guide: '#888888'
    };

    // Callbacks
    this.onComplete = null;
    this.onReady = null;  // Called when lines are ready for approval

    this.handleResize = this.handleResize.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);

    window.addEventListener('resize', this.handleResize);
    this.handleResize();
  }

  /**
   * Activate the overlay for drawing
   */
  activate() {
    this.canvas.style.display = 'block';
    this.canvas.classList.add('active');

    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointerleave', this.handlePointerUp);

    // Reset state
    this.lines = { x: null, y: null };
    this.currentAxis = 'x';
    this.isDrawing = false;

    this.draw();
  }

  /**
   * Deactivate the overlay
   */
  deactivate() {
    this.canvas.style.display = 'none';
    this.canvas.classList.remove('active');

    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointerleave', this.handlePointerUp);
  }

  handleResize() {
    const container = this.canvas.parentElement;
    const rect = container.getBoundingClientRect();

    this.canvas.width = rect.width;
    this.canvas.height = rect.height;

    this.draw();
  }

  handlePointerDown(e) {
    e.preventDefault();
    this.isDrawing = true;
    this.startPoint = this.getPoint(e);
    this.currentLine = { start: this.startPoint, end: this.startPoint };
    this.draw();
  }

  handlePointerMove(e) {
    if (!this.isDrawing || !this.startPoint) return;

    const point = this.getPoint(e);
    this.currentLine = { start: this.startPoint, end: point };
    this.draw();
  }

  handlePointerUp(e) {
    if (!this.isDrawing || !this.currentLine) return;

    this.isDrawing = false;

    // Check if line is long enough (minimum 50 pixels)
    const dx = this.currentLine.end.x - this.currentLine.start.x;
    const dy = this.currentLine.end.y - this.currentLine.start.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length >= 50) {
      // Save the line
      this.lines[this.currentAxis] = { ...this.currentLine };

      // Move to next axis or show approve button
      if (this.currentAxis === 'x') {
        this.currentAxis = 'y';
      } else {
        // Both lines drawn - signal ready for approval
        if (this.onReady) {
          this.onReady(this.lines);
        }
      }
    }

    this.currentLine = null;
    this.startPoint = null;
    this.draw();
  }

  getPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  /**
   * Draw the overlay
   */
  draw() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, width, height);

    // Draw center guides
    ctx.strokeStyle = this.colors.guide;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);

    // Vertical center
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.stroke();

    // Horizontal center
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    ctx.setLineDash([]);

    // Draw saved lines
    if (this.lines.x) {
      this.drawLine(this.lines.x, this.colors.x, 'X-Axis');
    }
    if (this.lines.y) {
      this.drawLine(this.lines.y, this.colors.y, 'Y-Axis');
    }

    // Draw current line being drawn
    if (this.currentLine) {
      const color = this.currentAxis === 'x' ? this.colors.x : this.colors.y;
      this.drawLine(this.currentLine, color);
    }

    // Draw instructions
    this.drawInstructions();
  }

  /**
   * Draw a line with endpoints
   */
  drawLine(line, color, label = null) {
    const ctx = this.ctx;

    // Line
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(line.start.x, line.start.y);
    ctx.lineTo(line.end.x, line.end.y);
    ctx.stroke();

    // Endpoints
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(line.start.x, line.start.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(line.end.x, line.end.y, 6, 0, Math.PI * 2);
    ctx.fill();

    // Label
    if (label) {
      const midX = (line.start.x + line.end.x) / 2;
      const midY = (line.start.y + line.end.y) / 2;

      ctx.fillStyle = color;
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, midX, midY - 10);
    }
  }

  /**
   * Draw instructions panel
   */
  drawInstructions() {
    const ctx = this.ctx;
    const padding = 16;
    const lineHeight = 24;

    let instructions;
    if (!this.lines.x) {
      instructions = [
        'Step 1 of 2: Draw the X-Axis line',
        'Draw along a horizontal edge in your image',
        '(e.g., bottom of a window, edge of a table)'
      ];
    } else if (!this.lines.y) {
      instructions = [
        'Step 2 of 2: Draw the Y-Axis line',
        'Draw along a vertical edge in your image',
        '(e.g., corner of a building, door frame)'
      ];
    } else {
      instructions = ['Click Apply to correct perspective'];
    }

    // Background
    const boxWidth = 350;
    const boxHeight = padding * 2 + lineHeight * instructions.length;
    const boxX = (this.canvas.width - boxWidth) / 2;
    const boxY = 20;

    ctx.fillStyle = 'rgba(30, 30, 30, 0.9)';
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 8);
    ctx.fill();

    // Border
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Text
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';

    instructions.forEach((text, i) => {
      const y = boxY + padding + 16 + i * lineHeight;
      if (i === 0) {
        ctx.font = 'bold 14px sans-serif';
        ctx.fillStyle = this.currentAxis === 'x' ? this.colors.x : this.colors.y;
      } else {
        ctx.font = '13px sans-serif';
        ctx.fillStyle = '#aaa';
      }
      ctx.fillText(text, this.canvas.width / 2, y);
    });
  }

  /**
   * Get the drawn lines
   * @returns {{x: object|null, y: object|null}}
   */
  getLines() {
    return this.lines;
  }

  /**
   * Reset the overlay
   */
  reset() {
    this.lines = { x: null, y: null };
    this.currentAxis = 'x';
    this.currentLine = null;
    this.startPoint = null;
    this.isDrawing = false;
    this.draw();
  }

  /**
   * Dispose of resources
   */
  dispose() {
    window.removeEventListener('resize', this.handleResize);
    this.deactivate();
  }
}
