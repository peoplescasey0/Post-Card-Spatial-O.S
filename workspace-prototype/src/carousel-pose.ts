export type CarouselPose = {
  x: number;
  y: number;
  z: number;
  scale: number;
};

export function carouselPoseFromAngle(theta: number): CarouselPose {
  const depth = (1 + Math.cos(theta)) / 2;
  return {
    x: 4.85 * Math.sin(theta),
    y: 2.64 + (Math.cos(theta) - 1) * 0.32,
    z: 3.3 * Math.cos(theta) - 1.05,
    scale: 0.64 + depth * 0.4,
  };
}
