export type CarouselPose = {
  x: number;
  y: number;
  z: number;
  scale: number;
};

/**
 * Panoramic cockpit arc.
 *
 * Cards ride a wide, shallow concave band around the viewer: the front slot is
 * pulled toward the camera, the rear slot is parked deep behind the floor
 * pool, and the horizontal radius is wide enough that neighbouring cards sit
 * side-by-side rather than stacking. Depth falls away more slowly than a plain
 * circle, so the cards either side of the focus stay legible (scale >= 0.88,
 * z > 0.5) while the far side of the ring still reads as a real turntable.
 */
export function carouselPoseFromAngle(theta: number): CarouselPose {
  const cos = Math.cos(theta);
  const depth = (1 + cos) / 2;
  return {
    x: 4.35 * Math.sin(theta),
    y: 2.64 + (cos - 1) * 0.46,
    z: 3.6 * cos - 0.5,
    scale: 0.62 + depth * 0.47,
  };
}
