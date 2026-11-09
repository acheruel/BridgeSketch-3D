// BridgeSketch 3D · Vehicles, trains and cyclists: placement and animation.
import * as T from 'three';
import {
  addRoofAccessory,
  createContactShadow,
  createVehicleModel,
  vehicleDimensions,
  vehiclePaint,
  vehicleRandom,
} from './vehicles.mjs';
import { crossAt, frame, profile, totalLength, vehicleFits } from './geometry.mjs';

// extra.path: { min, max, lift } keeps a rider on a sidewalk (u limits, height above the road); extra.speed in km/h.
export function vehicle(parent, m, c, s, u, type, forward = true, road, extra = {}) {
  if (!c.showTraffic) return;
  if (type === 'car') type = 'sedan';
  let dimensions = vehicleDimensions(type);
  const path = extra.path ?? null,
    fits = d =>
      road
        ? Math.abs(u) + d.halfWidth <= road.width / 2 - 0.2
        : path
          ? u - d.halfWidth >= path.min - 1e-6 && u + d.halfWidth <= path.max + 1e-6
          : vehicleFits(c, s, u, d.halfLength, d.halfWidth);
  if (!fits(dimensions)) {
    if (path) return;
    type = c.trafficMode === 'cyclists' && !road ? 'cyclist' : 'sedan';
    dimensions = vehicleDimensions(type);
    if (!fits(dimensions)) return;
  }
  // Deterministic per-vehicle identity: curated paint (mostly white / black / grey / silver), small size variety,
  // occasional roof box or rack. All geometry and materials are shared between vehicles.
  const n = Math.floor(s * 3 + u * 7 + c.seed),
    group = createVehicleModel(type, vehiclePaint(n, type), m);
  if (['sedan', 'suv', 'hatchback', 'pickup', 'van'].includes(type)) {
    const lateral = 0.99 + 0.025 * vehicleRandom(n, 2);
    group.scale.set(lateral, 0.965 + 0.065 * vehicleRandom(n, 3), lateral);
    addRoofAccessory(group, type, vehicleRandom(n, 4));
  }
  if (type !== 'train') group.add(createContactShadow(dimensions.length, dimensions.width));
  const route = {
    s,
    u,
    type,
    forward,
    road: road ?? null,
    halfLength: dimensions.halfLength,
    halfWidth: dimensions.halfWidth,
    speed: extra.speed ?? (type === 'cyclist' ? 17 : 30),
    path,
  };
  group.userData.route = route;
  positionVehicle(group, c);
  parent.userData.vehicles ??= [];
  parent.userData.vehicles.push({ ...route, road: !!road });
  let traffic = parent.children.find(o => o.name === 'Traffic');
  if (!traffic) {
    traffic = new T.Group();
    traffic.name = 'Traffic';
    parent.add(traffic);
  }
  traffic.add(group);
  return group;
}

export function positionVehicle(group, c) {
  const { s, u, forward, road, halfLength, halfWidth, verticalOffset = 0 } = group.userData.route;
  // 0.6.9: imported road follows a polyline and the sampled terrain, including its local grade.
  if(road?.sample) {
    const p=road.sample(s,u),a=road.sample(s-.5,u),b=road.sample(s+.5,u),left=road.sample(s,u-.5),right=road.sample(s,u+.5),dir=forward?1:-1;
    group.position.set(p.x,p.y+.025+verticalOffset,p.z);group.rotation.order='YZX';
    group.rotation.set(-Math.atan(right.y-left.y)*dir,-Math.atan2(p.tz,p.tx)+(forward?0:Math.PI),Math.atan2(b.y-a.y,Math.hypot(b.x-a.x,b.z-a.z))*dir);
    group.visible=Math.abs(s)<=road.halfLength-halfLength;return;
  }
  // Bank the body onto the crossfall (about the 1.8 m axle track) so the wheels sit flush on the deck instead of
  // floating on the low side; trains and flat carriageways stay level. Constant for a vehicle, so computed once.
  if (group.userData.roll === undefined) {
    const slope = road
      ? group.userData.route.type === 'train'
        ? 0
        : -0.02 * Math.sign(u)
      : (crossAt(c, u + 0.9) - crossAt(c, u - 0.9)) / 1.8;
    group.userData.roll = -Math.atan(slope) * (forward ? 1 : -1);
  }
  const f = road
    ? { x: road.x + road.dx * s + road.nx * u, z: road.z + road.dz * s + road.nz * u, tx: road.dx, tz: road.dz }
    : frame(c, s, u);
  // Deck vehicles ride on the crossfall; crossing-road vehicles on the 2 % crown (not trains on their ballast).
  const path = group.userData.route.path,
    lift = road ? (group.userData.route.type === 'train' ? 0 : -0.02 * Math.abs(u)) : crossAt(c, u) + (path?.lift ?? 0);
  group.position.set(f.x, (road ? road.elevation : profile(c, s)) + lift + 0.025 + verticalOffset, f.z);
  group.rotation.order = 'YZX'; // yaw, then pitch (grade), then roll (crossfall) in the vehicle's own axes
  group.rotation.set(
    group.userData.roll,
    -Math.atan2(f.tz, f.tx) + (forward ? 0 : Math.PI),
    Math.atan(road ? 0 : (profile(c, s + 0.1) - profile(c, s - 0.1)) / 0.2) * (forward ? 1 : -1),
  );
  group.visible = road
    ? group.userData.route.type !== 'train' || Math.abs(s) <= road.halfLength + halfLength
    : path
      ? s >= -c.approach - 17 && s <= totalLength(c) + c.approach + 17
      : vehicleFits(c, s, u, halfLength, halfWidth);
}

export function animateTraffic(model, dt) {
  if (!model.config.movingTraffic || !model.config.showTraffic || !Number.isFinite(dt) || dt <= 0) return;
  const c = model.config;
  for (const group of model.vehicles) {
    // 0.6.6: a vehicle Sketchy bonked in free roam flies on its own for a few seconds.
    if (group.userData.bonked) continue;
    const r = group.userData.route,
      reach = r.road
        ? r.road.halfLength + (r.type === 'train' ? r.halfLength : -r.halfLength)
        : c.approach + 17 - r.halfLength;
    const gap = r.offscreenGap ?? 0,
      start = -reach - (r.forward ? 0 : gap),
      end = r.road ? reach + (r.forward ? gap : 0) : totalLength(c) + reach,
      range = end - start;
    if (range <= 0) continue;
    // Equal speeds preserve spacing in each lane; traffic wraps at the scenery edge.
    const step = (dt * (r.speed ?? 30)) / 3.6;
    r.s = start + ((((r.s + (r.forward ? 1 : -1) * step - start) % range) + range) % range);
    positionVehicle(group, c);
    // Cyclists pedal and their wheels turn with the distance travelled.
    if (group.userData.pose) {
      r.travel = (r.travel ?? 0) + step;
      group.userData.pose(r.travel);
    }
  }
}
