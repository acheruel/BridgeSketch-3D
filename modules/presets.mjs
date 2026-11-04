import { defaults, validate, fitBoxLayoutFromBottom } from './geometry.mjs';

// Eight complete starting concepts; each selection resets every parameter.
export const presets = [
  {
    "id": "river",
    "label": "Fall river · 5 steel spans",
    "description": "Autumn afternoon on five continuous variable-depth blue steel spans, curved and skewed; four-column bents with tapered caps in the river.",
    // 0.6.4: the welcome concept opens on its own camera.
    "camera": {"position":[-111.7,61.32,124.39],"target":[-47.7,23.23,54.19],"view":"perspective"},
    "config": {
      ...defaults,
      "width": 25,
      "overhang": 1.6,
      "girders": 8,
      "material": "steel",
      "variableDepth": true,
      "taper": 45,
      "steelColor": "blue15065",
      "barrierType": "steel",
      "leftRailing": "311A",
      "rightRailing": "210C",
      "sidewalkRailing": "301",
      "approachBarrier": "extend",
      "lighting": "poles",
      "lightSpacing": 45,
      "lightColor": "warm",
      "wingAngle": 35,
      "laneCount": 4,
      "sidewalkSide": "right",
      "sidewalkWidth": 4,
      "laneWidth": 3.7,
      "waterStyle": "natural",
      "weather": "leaves",
      "bentWidth": 2,
      "bentThickness": 1.6,
      "bentEndThickness": 1.2,
      "bentTaperStart": 11,
      "columns": 4,
      "columnDiameter": 1.8,
      "columnSpread": 19,
      "wallThickness": 1.2,
      "bloom": true,
      "birds": false,
      "skew": 10,
      "curved": true,
      "radius": 700,
      "elevation": 8,
      "rise": 1.5,
      "approach": 26,
      "frontSlope": true,
      "frontSlopeMaterial": "stone",
      "approachConeMaterial": "stone",
      // 0.6.6: architectural formliner on the abutments.
      "abutmentFinish": "formliner",
      "terrainMode": "fall",
      "sceneWidth": 300,
      "timeOfDay": 14.5,
      // 0.6.5: the clock runs from 14:30 like the other concepts.
      "timeFlow": true,
      "seed": 24,
      "medianType": "barrier",
      "spans": [
        {
          "length": 28,
          "obstacle": "land",
          "width": 10,
          "elevation": 0,
          "angle": 90
        },
        {
          "length": 36,
          "obstacle": "water",
          "width": 26,
          "elevation": -1,
          "angle": 80
        },
        {
          "length": 42,
          "obstacle": "water",
          "width": 26,
          "elevation": -1,
          "angle": 80
        },
        {
          "length": 36,
          "obstacle": "water",
          "width": 26,
          "elevation": -1,
          "angle": 80
        },
        {
          "length": 28,
          "obstacle": "land",
          "width": 10,
          "elevation": 0,
          "angle": 90
        }
      ]
    }
  },
  {
    "id": "box",
    "label": "Rainy crossing · 4 curved boxes",
    "description": "Four continuous curved steel-box spans on single-column hammerheads over roads and a railway; 3 % crossfall.",
    "config": {
      ...defaults,
      "hammerheadShape": "oblong",
      "width": 13.6,
      "overhang": 3.75,
      "girders": 2,
      "material": "box",
      "depth": 1.7,
      "variableDepth": true,
      "pierDepth": 2.4,
      "steelColor": "blue",
      "barrierType": "steel",
      "leftRailing": "210C",
      "rightRailing": "210C",
      "sidewalkSide": "right",
      "sidewalkWidth": 2.5,
      "boxTopWidth": 5.1,
      "boxBottomWidth": 3.55,
      "weather": "rain",
      "pierType": "hammerhead",
      "columns": 1,
      "columnDiameter": 1.8,
      "hammerheadWidth": 2.6,
      "skew": 10,
      "curved": true,
      "radius": 180,
      "elevation": 8.6,
      "approach": 28,
      "sceneWidth": 130,
      "timeOfDay": 14,
      "seed": 31,
      "crossfall": "right",
      "crossSlope": 3,
      "concreteFinish": "light",
      "spans": [
        {
          "length": 34,
          "obstacle": "road",
          "width": 12,
          "elevation": 0,
          "angle": 80
        },
        {
          "length": 46,
          "obstacle": "rail",
          "width": 9,
          "elevation": 0,
          "angle": 90
        },
        {
          "length": 42,
          "obstacle": "road",
          "width": 12,
          "elevation": 0,
          "angle": 100
        },
        {
          "length": 30,
          "obstacle": "land",
          "width": 10,
          "elevation": 0,
          "angle": 90
        }
      ]
    }
  },
  {
    "id": "cycle",
    "label": "Night cycle arch · 1 span",
    "description": "A 45 m steel tied arch for cyclists, illuminated SDC railings, physical sky and stars.",
    "config": {
      ...defaults,
      "width": 4.8,
      "overhang": 0.5,
      "girders": 2,
      "material": "steel",
      "depth": 0.9,
      "pierDepth": 1.7,
      "steelColor": "gray16515",
      "barrierType": "steel",
      "leftRailing": "SDC",
      "rightRailing": "SDC",
      "approachBarrier": "extend",
      "lighting": "handrail",
      "lightSpacing": 3,
      "lightColor": "warm",
      "laneCount": 1,
      "boxTopWidth": 3,
      "laneWidth": 1.8,
      "trafficMode": "cyclists",
      "elevation": 6.2,
      "rise": 0.25,
      "approach": 20,
      "sceneWidth": 110,
      "timeOfDay": 22.5,
      "seed": 48,
      "structureSystem": "arch",
      "archType": "tied",
      "archMaterial": "steel",
      "archRise": 0.2,
      "spans": [
        {
          "length": 45,
          "obstacle": "water",
          "width": 30,
          "elevation": 0,
          "angle": 90
        }
      ]
    }
  },
  {
    "id": "truss",
    "label": "Truss footbridge · 2 spans",
    "description": "0.6.6: a continuous steel through truss (Warren with posts) for cyclists and pedestrians, two 36 m spans over a river.",
    "config": {
      ...defaults,
      "width": 4.6,
      "overhang": 0.3,
      "girders": 2,
      "material": "steel",
      "depth": 0.5,
      "steelColor": "green",
      "barrierType": "steel",
      "leftRailing": "20C",
      "rightRailing": "20C",
      "approachBarrier": "extend",
      "laneCount": 1,
      "laneWidth": 2.4,
      "trafficMode": "cyclists",
      "continuous": true,
      "pierType": "wall",
      "wallThickness": 1.2,
      "wallEnds": "round",
      "elevation": 7.5,
      "rise": 0.5,
      "approach": 22,
      "sceneWidth": 130,
      "timeOfDay": 10.5,
      "seed": 52,
      "structureSystem": "truss",
      "trussType": "through",
      "trussPattern": "warren",
      "trussPanel": 4,
      "trussHeight": 4.2,
      "trussBraceSpacing": 4,
      "spans": [
        {
          "length": 36,
          "obstacle": "water",
          "width": 44,
          "elevation": 0,
          "angle": 90
        },
        {
          "length": 36,
          "obstacle": "water",
          "width": 44,
          "elevation": 0,
          "angle": 90
        }
      ]
    }
  },
  {
    "id": "psbox",
    "label": "Snow viaduct · 8 spans",
    "description": "A curved winter viaduct: twin prestressed boxes of constant depth on 50 m spans, over roads, railways, a river and open ground.",
    "config": {
      ...defaults,
      "wallEnds": "round",
      "width": 16.5,
      "material": "psbox",
      "depth": 2.8,
      "variableDepth": false,
      "leftRailing": "311A",
      "rightRailing": "311A",
      "lighting": "poles",
      "lightSides": "right",
      "laneCount": 4,
      "weather": "snow",
      "pierType": "wall",
      "wallThickness": 2.0,
      "curved": true,
      "radius": 600,
      "direction": -1,
      "elevation": 16,
      "rise": 1.1,
      "approach": 45,
      "terrainMode": "snow",
      "sceneWidth": 300,
      "timeOfDay": 9,
      "seed": 61,
      "psboxCount": 2,
      "concreteFinish": "light",
      "spans": [
        {
          "length": 40,
          "obstacle": "land",
          "width": 12,
          "elevation": 0,
          "angle": 90
        },
        {
          "length": 50,
          "obstacle": "road",
          "width": 12,
          "elevation": 0,
          "angle": 80
        },
        {
          "length": 50,
          "obstacle": "rail",
          "width": 8,
          "elevation": 0,
          "angle": 90
        },
        {
          "length": 50,
          "obstacle": "water",
          "width": 40,
          "elevation": 0,
          "angle": 90
        },
        {
          "length": 50,
          "obstacle": "water",
          "width": 40,
          "elevation": 0,
          "angle": 90
        },
        {
          "length": 50,
          "obstacle": "rail",
          "width": 8,
          "elevation": 0,
          "angle": 95
        },
        {
          "length": 50,
          "obstacle": "road",
          "width": 12,
          "elevation": 0,
          "angle": 100
        },
        {
          "length": 40,
          "obstacle": "land",
          "width": 12,
          "elevation": 0,
          "angle": 90
        }
      ]
    }
  },
  {
    "id": "strutted",
    "label": "Autumn béquilles · 3 spans",
    "description": "A 70 m strutted frame (inclined legs) with 30 m side spans, autumn foliage and falling leaves.",
    "config": {
      ...defaults,
      "width": 12.4,
      "material": "psbox",
      "depth": 1.8,
      "variableDepth": true,
      "pierDepth": 3.4,
      "leftRailing": "311",
      "rightRailing": "311",
      "weather": "leaves",
      "elevation": 15,
      "rise": 0.9,
      "approach": 28,
      "terrainMode": "fall",
      "sceneWidth": 220,
      "timeOfDay": 16,
      "seed": 72,
      "structureSystem": "strutted",
      "concreteFinish": "light",
      "spans": [
        {
          "length": 30,
          "obstacle": "road",
          "width": 8,
          "elevation": 0,
          "angle": 90
        },
        {
          "length": 70,
          "obstacle": "water",
          "width": 48,
          "elevation": 0,
          "angle": 90
        },
        {
          "length": 30,
          "obstacle": "road",
          "width": 8,
          "elevation": 0,
          "angle": 90
        }
      ]
    }
  },
  {
    "id": "deck-arch",
    "label": "Sunrise deck arch · 6 spans",
    "description": "A 100 m concrete deck arch across a valley, with 20–22 m slab approach spans on wall piers, at sunrise.",
    "config": {
      ...defaults,
      "wallEnds": "round",
      "width": 12.4,
      "material": "slab",
      "slabDepth": 1.0,
      "leftRailing": "311A",
      "rightRailing": "311A",
      "pierType": "wall",
      "wallThickness": 1.2,
      "elevation": 26,
      "rise": 0.6,
      "approach": 34,
      "terrainShape": "profile",
      "sceneWidth": 240,
      "timeOfDay": 6.8,
      "seed": 83,
      "structureSystem": "arch",
      "concreteFinish": "light",
      "spans": [
        {
          "length": 20,
          "obstacle": "road",
          "width": 7,
          "elevation": 0,
          "angle": 90
        },
        {
          "length": 22,
          "obstacle": "land",
          "width": 8,
          "elevation": 0,
          "angle": 90
        },
        {
          "length": 100,
          "obstacle": "water",
          "width": 44,
          "elevation": 0,
          "angle": 90
        },
        {
          "length": 22,
          "obstacle": "land",
          "width": 8,
          "elevation": 0,
          "angle": 90
        },
        {
          "length": 22,
          "obstacle": "rail",
          "width": 8,
          "elevation": 0,
          "angle": 90
        },
        {
          "length": 20,
          "obstacle": "road",
          "width": 7,
          "elevation": 0,
          "angle": 90
        }
      ]
    }
  },
  {
    "id": "overpass",
    "label": "TSM overpass · 2 NEBT spans",
    "description": "Two continuous 36 m NEBT 1600 spans over a divided highway, three-column bent with tapered cap, TSM approach walls, rain at dusk.",
    "config": {
      ...defaults,
      "width": 12.6,
      "overhang": 1.1,
      "depth": 1.6,
      "lighting": "poles",
      "lightSides": "right",
      "weather": "rain",
      "bentWidth": 1.6,
      "bentThickness": 1.1,
      "bentEndThickness": 0.7,
      "bentTaperStart": 3,
      "columns": 3,
      "columnDiameter": 1.1,
      "elevation": 8.2,
      "rise": 0.35,
      "approach": 40,
      "approachWalls": "mse",
      "sceneWidth": 170,
      "timeOfDay": 17.5,
      "seed": 118,
      "centreLine": "double",
      "concreteFinish": "light",
      "spans": [
        {
          "length": 36,
          "obstacle": "road",
          "width": 12,
          "elevation": 0,
          "angle": 90
        },
        {
          "length": 36,
          "obstacle": "road",
          "width": 12,
          "elevation": 0,
          "angle": 90
        }
      ]
    }
  }
];

export function makePreset(id) {
  const preset = presets.find(p => p.id === id);
  if (!preset) throw Error('Select a bridge preset.');
  const config = structuredClone(preset.config);
  return validate(config.material === 'box' ? fitBoxLayoutFromBottom(config) : config);
}
