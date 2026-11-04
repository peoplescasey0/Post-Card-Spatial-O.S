export type CarouselPose = {
  x: number;
  y: number;
  z: number;
  scale: number;
};

export function carouselPoseFromAngle(theta: number): CarouselPose {
  const depth = (1 + Math.cos(theta)) / 2;
  return {
    x: 4.25 * Math.sin(theta),
    y: 2.64 + (Math.cos(theta) - 1) * 0.46,
    z: 3.2 * Math.cos(theta) - 1,
    scale: 0.64 + depth * 0.4,
  };
}
