import { buildTrack, S, R, L } from './trackBuilder.js';

// Catálogo de pistas (HU02/HU05). Cada pista es un circuito inspirado en un
// trazado real de Fórmula 1, con identidad visual de una región de
// Colombia. El trazado se describe con rectas y curvas (ver trackBuilder.js)
// y el resto (muros, puntos de control, objetos, parrilla) se genera solo.

export const TRACKS = [
  buildTrack({
    id: 'caribe',
    name: 'Costa de Cartagena',
    region: 'Región Caribe',
    inspiration: 'Monza',
    description: 'El templo de la velocidad junto al mar: rectas eternas cortadas por chicanas y una parabólica final.',
    roadWidth: 86,
    checkpoints: 10,
    pickups: 7,
    palette: { sky: ['#0b3d55', '#1489a8', '#f2c14e'], grass: '#d9c07a', road: '#3a3f47', accent: '#f2c14e' },
    design: [
      S(820),                           // recta principal
      R(62, 85), S(20), L(62, 85),      // primera chicana
      S(160),
      R(250, 60),                       // Curva Grande
      S(60),
      L(64, 80), S(20), R(64, 80),      // chicana de la Roggia
      S(60),
      R(140, 60),                       // Lesmo 1
      S(60),
      R(120, 60),                       // Lesmo 2
      S(520),                           // recta del bosque
      L(80, 35), R(80, 70), L(80, 35),  // Ascari
      S(650),                           // recta opuesta
      R(313, 'auto')                    // Parabólica
    ]
  }),
  buildTrack({
    id: 'andes',
    name: 'Altiplano de Bogotá',
    region: 'Región Andina',
    inspiration: 'Mónaco',
    description: 'Callejero estrecho y lento: horquilla cerrada, túnel curvo y las chicanas de la piscina.',
    roadWidth: 72,
    checkpoints: 12,
    pickups: 6,
    palette: { sky: ['#1c2b45', '#3a5a78', '#8fb3c9'], grass: '#274a34', road: '#40454d', accent: '#8fd0ff' },
    design: [
      S(420),                           // recta de boxes
      R(62, 90),                        // Sainte Devote
      S(300),                           // subida Beau Rivage
      L(170, 45),                       // Massenet
      R(85, 70),                        // Casino
      S(100),
      R(62, 65),                        // Mirabeau
      S(80),
      L(56, 170),                       // horquilla del Grand Hotel
      S(80),
      R(62, 90),                        // Portier
      R(260, 80),                       // el túnel
      S(220),
      L(58, 75), S(15), R(58, 75),      // chicana del puerto
      S(150),
      R(75, 90),                        // Tabac
      S(300),
      L(60, 60), R(60, 60),             // piscina 1
      S(150),
      R(60, 60), L(60, 60),             // piscina 2
      S(250),
      R(58, 60),                        // Rascasse
      S(60),
      R(64, 'auto')                     // Anthony Noghes
    ]
  }),
  buildTrack({
    id: 'cafetero',
    name: 'Eje Cafetero',
    region: 'Región Andina — zona cafetera',
    inspiration: 'Suzuka',
    description: 'Las eses entre cafetales, la horquilla, la doble curva Spoon y la temida 130R.',
    roadWidth: 80,
    checkpoints: 12,
    pickups: 7,
    palette: { sky: ['#274423', '#4c7a3f', '#cfe6a8'], grass: '#3c6b2f', road: '#3a3f47', accent: '#c98a3a' },
    design: [
      S(560),                                         // recta principal
      R(150, 60), R(110, 30),                         // curvas 1 y 2
      S(60),
      L(95, 55), R(95, 65), L(95, 65), R(95, 55),     // las eses
      R(220, 40),                                     // Dunlop
      S(170),
      R(110, 30), S(60), R(85, 20),                   // Degner 1 y 2
      S(260),
      L(64, 165),                                     // horquilla
      S(320),
      R(150, 60), S(40), R(120, 105),                 // Spoon
      S(330),                                         // recta trasera
      R(280, 35),                                     // 130R
      S(100),
      R(62, 85), S(20), L(62, 85),                    // chicana Casio
      S(80),
      R(140, 55),                                     // curva final
      S(200), L(420, 22), S(220), R(420, 22), S(200), // regreso entre cafetales
      R(130, 'auto')                                  // entrada a la recta
    ]
  }),
  buildTrack({
    id: 'llanos',
    name: 'Llanos Orientales',
    region: 'Región Orinoquía',
    inspiration: 'Silverstone',
    description: 'Curvas rápidas a fondo bajo el atardecer llanero: Copse, el complejo Maggotts-Becketts y Stowe.',
    roadWidth: 92,
    checkpoints: 12,
    pickups: 8,
    palette: { sky: ['#3a1f14', '#a2531f', '#f2b13d'], grass: '#8a7331', road: '#3a3f47', accent: '#f2b13d' },
    design: [
      S(600),                                         // recta Hamilton
      R(180, 45),                                     // Abbey
      L(200, 45),                                     // Farm
      S(100),
      R(70, 90),                                      // Village
      S(60),
      L(65, 90),                                      // The Loop
      R(160, 90),                                     // Aintree
      S(360),                                         // Wellington
      R(90, 90),                                      // Brooklands
      S(120),
      L(95, 150),                                     // Luffield
      R(170, 150),                                    // Woodcote
      R(150, 45),                                     // Copse
      S(180),
      L(160, 40), R(150, 55), L(150, 50), R(170, 35), // Maggotts-Becketts-Chapel
      S(560),                                         // Hangar
      R(140, 60),                                     // Stowe
      S(150),
      L(68, 70), R(68, 100),                          // Vale
      S(200),
      R(150, 'auto')                                  // Club
    ]
  }),
  buildTrack({
    id: 'amazonia',
    name: 'Selva Amazónica',
    region: 'Región Amazonía',
    inspiration: 'Interlagos',
    description: 'Antihorario y técnico entre la selva: la S del Senna, la Ferradura y el Pinheirinho.',
    roadWidth: 76,
    clockwise: false,
    checkpoints: 14,
    pickups: 7,
    palette: { sky: ['#08210f', '#12401f', '#2f6b2a'], grass: '#0f3d1c', road: '#33251c', accent: '#7ee08a' },
    design: [
      S(520),                                         // recta principal
      L(62, 85), R(70, 40),                           // S del Senna
      L(260, 45),                                     // Curva do Sol
      S(560),                                         // Reta Oposta
      L(85, 90),                                      // Descida do Lago
      S(160),
      R(110, 45), R(90, 45),                          // Ferradura
      L(62, 130),                                     // Pinheirinho
      S(90),
      R(58, 140),                                     // Bico de Pato
      S(120),
      L(110, 75),                                     // Mergulho
      S(140),
      L(70, 115),                                     // Junção
      S(150), R(650, 30), S(250), L(650, 30), S(200), // subida de boxes entre la selva
      L(240, 'auto')                                  // entrada a la recta
    ]
  })
];

export function getTrackById(id) {
  return TRACKS.find(t => t.id === id) || TRACKS[0];
}
