import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig, DEFAULT_RIG_OPTIONS } from '../../../src/infrastructure/three/CameraRig';

/** Sin giro ni parallax la geometría es trivial: la cámara está en (x, y, distancia) mirando a (x, y, 0). */
const FLAT = { pitch: 0, yaw: 0, parallax: 0 };
const TAN = Math.tan((38 * Math.PI) / 360);

function rigWith(options = {}, aspect = 2): { rig: CameraRig; camera: PerspectiveCamera } {
  const camera = new PerspectiveCamera(38, aspect, 0.5, 1600);
  return { rig: new CameraRig(camera, options), camera };
}

function settle(rig: CameraRig, seconds = 20): void {
  for (let i = 0; i < seconds * 60; i += 1) rig.update(1 / 60);
}

describe('CameraRig: objetivo y límites', () => {
  it('arranca a distancia 40 sobre el origen', () => {
    const { rig } = rigWith();
    expect(rig.target).toEqual({ x: 0, y: 0, distance: 40 });
    expect(rig.distance).toBe(40);
  });

  it('shiftX traslada cámara y objetivo a la vez, sin transición (re-layout)', () => {
    const { rig, camera } = rigWith(FLAT);
    rig.flyTo({ x: 10, y: 0 }, 40);
    rig.snap();
    const before = camera.position.x;
    rig.shiftX(-4);
    expect(camera.position.x).toBeCloseTo(before - 4, 6);
    expect(rig.target.x).toBeCloseTo(6, 6);
    rig.flyAlong([{ x: 6, y: 0 }, { x: 20, y: 0 }], 40, 2);
    rig.shiftX(1);
    expect(rig.flying).toBe(false);
  });

  it('flyTo fija el punto de interés y, opcionalmente, la distancia', () => {
    const { rig } = rigWith();
    rig.flyTo({ x: 12, y: -3 });
    expect(rig.target).toEqual({ x: 12, y: -3, distance: 40 });
    rig.flyTo({ x: 1, y: 2 }, 25);
    expect(rig.target).toEqual({ x: 1, y: 2, distance: 25 });
  });

  it('el zoom es multiplicativo y se acota a [minDistance, maxDistance]', () => {
    const { rig } = rigWith();
    rig.zoomBy(0.5);
    expect(rig.target.distance).toBe(20);
    rig.zoomBy(0.01);
    expect(rig.target.distance).toBe(DEFAULT_RIG_OPTIONS.minDistance);
    rig.zoomBy(1000);
    expect(rig.target.distance).toBe(DEFAULT_RIG_OPTIONS.maxDistance);
    rig.setDistance(3);
    expect(rig.target.distance).toBe(9);
    rig.setDistance(50);
    expect(rig.target.distance).toBe(50);
  });

  it('las opciones se combinan con las de por defecto', () => {
    const { rig } = rigWith({ minDistance: 30 });
    rig.setDistance(1);
    expect(rig.target.distance).toBe(30);
    rig.setDistance(999);
    expect(rig.target.distance).toBe(DEFAULT_RIG_OPTIONS.maxDistance);
  });

  it('setBounds acota el objetivo actual y los movimientos posteriores', () => {
    const { rig } = rigWith();
    rig.flyTo({ x: 500, y: 500 });
    rig.setBounds({ minX: -10, maxX: 60, minY: -5, maxY: 8 });
    expect(rig.target).toMatchObject({ x: 60, y: 8 });
    rig.flyTo({ x: -99, y: -99 });
    expect(rig.target).toMatchObject({ x: -10, y: -5 });
    rig.panByPixels(-100000, 100000, 800);
    expect(rig.target).toMatchObject({ x: 60, y: 8 });
  });
});

describe('CameraRig: geometría', () => {
  it('halfHeightAt y distanceToFitWidth son coherentes con el fov y el aspecto', () => {
    const { rig } = rigWith({}, 2);
    expect(rig.halfHeightAt(40)).toBeCloseTo(40 * TAN, 10);
    const distance = rig.distanceToFitWidth(100);
    expect(rig.halfHeightAt(distance) * 2 * 2).toBeCloseTo(100, 8);
  });

  it('distanceToFitHeight encaja un alto en la fracción pedida del alto visible', () => {
    const { rig } = rigWith({}, 2);
    expect(rig.halfHeightAt(rig.distanceToFitHeight(30)) * 2).toBeCloseTo(30, 8);
    expect(rig.halfHeightAt(rig.distanceToFitHeight(30, 0.5)) * 2 * 0.5).toBeCloseTo(30, 8);
    expect(Number.isFinite(rig.distanceToFitHeight(30, 0))).toBe(true);
  });

  it('distanceToFitWidth no se dispara con aspectos degenerados', () => {
    const { rig } = rigWith({}, 0.01);
    expect(rig.distanceToFitWidth(10)).toBeCloseTo(10 / 2 / (TAN * 0.2), 8);
  });

  it('arrastrar desplaza el mundo con el puntero: 1 px = alto visible / alto del viewport', () => {
    const { rig } = rigWith();
    const worldPerPixel = (2 * 40 * TAN) / 800;
    rig.panByPixels(100, 50, 800);
    expect(rig.target.x).toBeCloseTo(-100 * worldPerPixel, 10);
    expect(rig.target.y).toBeCloseTo(50 * worldPerPixel, 10);
  });

  it('de lejos el mismo arrastre recorre más mundo; un viewport de alto 0 no divide por cero', () => {
    const near = rigWith().rig;
    const far = rigWith().rig;
    far.setDistance(80);
    near.panByPixels(-10, 0, 800);
    far.panByPixels(-10, 0, 800);
    expect(far.target.x).toBeCloseTo(near.target.x * 2, 10);
    const zero = rigWith().rig;
    zero.panByPixels(1, 0, 0);
    expect(Number.isFinite(zero.target.x)).toBe(true);
  });

  it('snap coloca la cámara en el objetivo mirando al punto de interés', () => {
    const { rig, camera } = rigWith(FLAT);
    rig.flyTo({ x: 10, y: 4 }, 30);
    rig.snap();
    expect(camera.position.toArray()).toEqual([10, 4, 30]);
    expect(rig.distance).toBe(30);
    const forward = camera.getWorldDirection(new Vector3());
    expect(forward.x).toBeCloseTo(0, 10);
    expect(forward.y).toBeCloseTo(0, 10);
    expect(forward.z).toBeCloseTo(-1, 10);
  });

  it('pitch y yaw colocan la cámara por encima y a un lado, a la misma distancia aproximada', () => {
    const { rig, camera } = rigWith({ parallax: 0 });
    rig.flyTo({ x: 10, y: 4 }, 30);
    rig.snap();
    expect(camera.position.x).toBeLessThan(10);
    expect(camera.position.y).toBeGreaterThan(4);
    expect(camera.position.z).toBeGreaterThan(25);
    // Sigue mirando al punto de interés.
    const toTarget = new Vector3(10, 4, 0).sub(camera.position).normalize();
    expect(camera.getWorldDirection(new Vector3()).distanceTo(toTarget)).toBeLessThan(1e-9);
  });

  it('setBias desplaza el encuadre en fracción del semiancho visible (deja sitio al pop-up)', () => {
    const { rig, camera } = rigWith(FLAT, 2);
    rig.flyTo({ x: 0, y: 0 }, 30);
    rig.setBias(0.5);
    rig.snap();
    expect(camera.position.x).toBeCloseTo(0.5 * 30 * TAN * 2, 10);
    // El punto de interés queda a la izquierda del centro de la imagen.
    expect(new Vector3(0, 0, 0).project(camera).x).toBeCloseTo(-0.5, 6);
  });
});

describe('CameraRig: animación', () => {
  it('update persigue el objetivo con amortiguación, sin pasarse, y converge', () => {
    const { rig, camera } = rigWith(FLAT);
    rig.snap();
    rig.flyTo({ x: 50, y: 0 }, 20);
    let previousX = camera.position.x;
    let previousDistance = rig.distance;
    for (let i = 0; i < 30; i += 1) {
      rig.update(1 / 60);
      expect(camera.position.x).toBeGreaterThan(previousX);
      expect(camera.position.x).toBeLessThan(50);
      expect(rig.distance).toBeLessThan(previousDistance);
      previousX = camera.position.x;
      previousDistance = rig.distance;
    }
    settle(rig);
    expect(camera.position.x).toBeCloseTo(50, 4);
    expect(rig.distance).toBeCloseTo(20, 4);
  });

  it('con movimiento reducido corta directo al objetivo, sin vuelo', () => {
    const { rig, camera } = rigWith(FLAT);
    rig.snap();
    rig.flyTo({ x: 50, y: 7 }, 20);
    rig.update(1 / 60, true);
    expect(camera.position.toArray()).toEqual([50, 7, 20]);
  });

  it('el puntero balancea la cámara (parallax), acotado a [-1, 1]', () => {
    const { rig, camera } = rigWith({ pitch: 0, yaw: 0, parallax: 0.1 });
    rig.flyTo({ x: 0, y: 0 }, 40);
    rig.snap();
    rig.setPointer(5, -5);
    settle(rig);
    expect(camera.position.x).toBeCloseTo(1 * 0.1 * 40, 3);
    expect(camera.position.y).toBeCloseTo(1 * 0.1 * 40, 3);
    rig.setPointer(-0.5, 0);
    settle(rig);
    expect(camera.position.x).toBeCloseTo(-0.5 * 0.1 * 40, 3);
    expect(camera.position.y).toBeCloseTo(0, 3);
  });

  it('con movimiento reducido no hay parallax', () => {
    const { rig, camera } = rigWith({ pitch: 0, yaw: 0, parallax: 0.1 });
    rig.setPointer(1, 1);
    rig.update(1, true);
    expect(camera.position.toArray()).toEqual([0, 0, 40]);
  });
});
