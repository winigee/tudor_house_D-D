// Projection from grid space to screen space, plus the movement tween.
// The renderer, not the sim, animates transitions: when the player's
// cell or facing changes, the camera glides there over transitionMs.

import { tuning } from '../config/tuning.ts';

export interface Camera {
  /** World position: grid units, cell centres at n + 0.5. */
  x: number;
  z: number;
  /** Yaw in radians; 0 faces north (-z), clockwise positive. */
  angle: number;
}

export interface Projected {
  sx: number;
  sy: number;
  /** Camera-space depth. */
  zc: number;
}

const W = tuning.render.internalWidth;
const WORLD_H = tuning.render.worldHeight;
const FOCAL = W / 2 / Math.tan(((tuning.render.fovDegrees / 2) * Math.PI) / 180);
const HORIZON = WORLD_H / 2;

export function toCameraSpace(cam: Camera, wx: number, wy: number, wz: number): [number, number, number] {
  const dx = wx - cam.x;
  const dz = wz - cam.z;
  const sin = Math.sin(cam.angle);
  const cos = Math.cos(cam.angle);
  // forward = (sin, -cos), right = (cos, sin)
  const xc = dx * cos + dz * sin;
  const zc = dx * sin - dz * cos;
  const yc = wy - tuning.render.eyeHeight;
  return [xc, yc, zc];
}

export function projectCameraSpace(xc: number, yc: number, zc: number): Projected {
  return {
    sx: W / 2 + (FOCAL * xc) / zc,
    sy: HORIZON - (FOCAL * yc) / zc,
    zc,
  };
}

/** Screen height in pixels of a world-space size at depth zc. */
export function scaleAt(size: number, zc: number): number {
  return (FOCAL * size) / zc;
}

/** Animates position and heading toward the sim's discrete state. */
export class CameraTween {
  private fromX = 0;
  private fromZ = 0;
  private fromAngle = 0;
  private toX = 0;
  private toZ = 0;
  private toAngle = 0;
  private startedAt = 0;
  private snapNext = true;

  /** Call when the level changes so the camera does not slide across it. */
  snap(): void {
    this.snapNext = true;
  }

  update(targetX: number, targetZ: number, targetAngle: number, nowMs: number): Camera {
    if (this.snapNext) {
      this.fromX = this.toX = targetX;
      this.fromZ = this.toZ = targetZ;
      this.fromAngle = this.toAngle = targetAngle;
      this.snapNext = false;
      this.startedAt = nowMs - tuning.render.transitionMs;
    }
    const changed =
      targetX !== this.toX || targetZ !== this.toZ || angleDelta(targetAngle, this.toAngle) !== 0;
    if (changed) {
      // Restart the glide from the camera's current interpolated pose.
      const cur = this.pose(nowMs);
      this.fromX = cur.x;
      this.fromZ = cur.z;
      this.fromAngle = cur.angle;
      this.toX = targetX;
      this.toZ = targetZ;
      this.toAngle = targetAngle;
      this.startedAt = nowMs;
    }
    return this.pose(nowMs);
  }

  private pose(nowMs: number): Camera {
    const t = Math.min(1, (nowMs - this.startedAt) / tuning.render.transitionMs);
    const ease = t * (2 - t);
    return {
      x: this.fromX + (this.toX - this.fromX) * ease,
      z: this.fromZ + (this.toZ - this.fromZ) * ease,
      angle: this.fromAngle + angleDelta(this.toAngle, this.fromAngle) * ease,
    };
  }
}

function angleDelta(to: number, from: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
