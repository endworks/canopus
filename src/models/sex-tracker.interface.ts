import { ApiProperty } from '@nestjs/swagger';

export class GoogleAuthResult {
  @ApiProperty()
  user;
}

export class AuthBody {
  username: string;
  password: string;
}

export class ActivityResult {
  activities: Activity[];
}

export enum Practice {
  MASTURBATION = 'MASTURBATION',
  VAGINAL = 'VAGINAL',
  ORAL = 'ORAL',
  ANAL = 'ANAL',
  BDSM = 'BDSM',
  DOMINATION = 'DOMINATION',
  BONDAGE = 'BONDAGE',
  CHOKING = 'CHOKING',
  CUDDLING = 'CUDDLING',
  HANDJOB = 'HANDJOB',
  FINGER = 'FINGER',
  TOY = 'TOY',
}
export enum Gender {
  MALE = 'M',
  FEMALE = 'F',
  NON_BINARY = 'NB',
}

export enum ActivityType {
  MASTURBATION = 'MASTURBATION',
  SEXUAL_INTERCOURSE = 'SEXUAL_INTERCOURSE',
}

export enum BirthControl {
  NO_BIRTH_CONTROL = 'NO_BIRTH_CONTROL',
  UNSAFE_BIRTH_CONTROL = 'UNSAFE_BIRTH_CONTROL',
  CONDOM = 'CONDOM',
  PILL = 'PILL',
  PATCH = 'PATCH',
  IMPLANT = 'IMPLANT',
  SHOT = 'SHOT',
  IUD = 'IUD',
  VAGINAL_RING = 'VAGINAL_RING',
  INTERNAL_CONDOM = 'INTERNAL_CONDOM',
  DIAPHRAGM = 'DIAPHRAGM',
  SPONGE = 'SPONGE',
  CERVICAL_CAP = 'CERVICAL_CAP',
  TUBAL_LIGATION = 'TUBAL_LIGATION',
  VASECTOMY = 'VASECTOMY',
  OUTERCOURSE = 'OUTERCOURSE',
}

export enum ActivityInitiator {
  SPONTANEOUSLY = 'SPONTANEOUSLY',
  ME = 'ME',
  PARTNER = 'PARTNER',
  BOTH = 'BOTH',
}

export enum Place {
  OTHER = 'OTHER',
  BEDROOM = 'BEDROOM',
  KITCHEN = 'KITCHEN',
  SHOWER = 'SHOWER',
  RESTROOM = 'RESTROOM',
  LIVING_ROOM = 'LIVING_ROOM',
  ELEVATOR = 'ELEVATOR',
  PARTY = 'PARTY',
  BATHROOM = 'BATHROOM',
  GARAGE = 'GARAGE',
  BACKYARD = 'BACKYARD',
  ROOF = 'ROOF',
  JACUZZI = 'JACUZZI',
  POOL = 'POOL',
  BEACH = 'BEACH',
  HOME = 'HOME',
  HOTEL = 'HOTEL',
  BAR = 'BAR',
  CINEMA = 'CINEMA',
  THEATRE = 'THEATRE',
  SCHOOL = 'SCHOOL',
  MUSEUM = 'MUSEUM',
  CAR = 'CAR',
  PLANE = 'PLANE',
  TRAIN = 'TRAIN',
  SHIP = 'SHIP',
  FOREST = 'FOREST',
  WORK = 'WORK',
  CHAIR = 'CHAIR',
  TABLE = 'TABLE',
  SOFA = 'SOFA',
  PUBLIC = 'PUBLIC',
}

export enum SafetyLevel {
  UNSAFE,
  PARTLY_UNSAFE,
  SAFE,
}

export class Activity {
  id?: number;
  partner: number;
  type: ActivityType;
  birth_control: BirthControl;
  partner_birth_control?: BirthControl;
  date: number;
  practices: Practice[];
  location?: string | null;
  notes?: string | null;
  duration?: number;
  orgasms?: number;
  partner_orgasms?: number;
  place: Place;
  initiator: ActivityInitiator;
  rating: number;
}

export interface Partner {
  id: number;
  sex: Gender;
  gender: any;
  name: string;
  meeting_date: number;
  encounters?: number;
}
