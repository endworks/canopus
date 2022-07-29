import { ApiProperty } from '@nestjs/swagger';

export class GoogleAuthResult {
  @ApiProperty()
  user;
}

export class AuthBody {
  @ApiProperty()
  username: string;

  @ApiProperty()
  password: string;
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
  @ApiProperty()
  id?: number;

  @ApiProperty()
  partner: number;

  @ApiProperty({
    enum: ActivityType,
  })
  type: ActivityType;

  @ApiProperty({
    enum: BirthControl,
  })
  birth_control: BirthControl;

  @ApiProperty({
    enum: BirthControl,
  })
  partner_birth_control?: BirthControl;

  @ApiProperty()
  date: number;

  @ApiProperty({
    enum: [Practice],
  })
  practices: Practice[];

  @ApiProperty()
  location?: string | null;

  @ApiProperty()
  notes?: string | null;

  @ApiProperty()
  duration?: number;

  @ApiProperty()
  orgasms?: number;

  @ApiProperty()
  partner_orgasms?: number;

  @ApiProperty({
    enum: Place,
  })
  place: Place;

  @ApiProperty({
    enum: ActivityInitiator,
  })
  initiator: ActivityInitiator;

  @ApiProperty()
  rating: number;
}

export class ActivityResult {
  @ApiProperty({
    type: () => Activity,
  })
  activities: Activity[];
}

export class Partner {
  @ApiProperty()
  id: number;

  @ApiProperty({
    enum: Gender,
  })
  sex: Gender;

  @ApiProperty()
  gender: any;

  @ApiProperty()
  name: string;

  @ApiProperty()
  meeting_date: number;

  @ApiProperty()
  encounters?: number;
}
