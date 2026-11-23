import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiDefaultResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponse } from '../models/error.interface';
import { AgendaService } from '../services/agenda.service';

const list = (value?: string) =>
  value
    ?.split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const point = (value?: string): [number, number] | undefined => {
  const [lon, lat] = (value ?? '').split(',').map(Number);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : undefined;
};

const int = (value?: string) => {
  const n = parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * What is on in Zaragoza: docs/agenda/api.md is the contract.
 *
 * Versioned in the path from the first release. Within v1 routes and fields
 * are only ever added; anything that would break an installed app goes to v2
 * beside it.
 */
@ApiTags('Agenda')
@ApiDefaultResponse({ description: 'Error response', type: ErrorResponse })
@Controller('agenda/v1')
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  @Get('feed')
  @ApiOperation({
    summary:
      'Every listed session in a window, with highlights and coming-up series: what the app keeps offline',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'YYYY-MM-DD, today by default',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    description: '1 to 60, 30 by default',
  })
  @ApiQuery({ name: 'lang', required: false, enum: ['es', 'en'] })
  feed(
    @Query('from') from?: string,
    @Query('days') days?: string,
    @Query('lang') lang?: string,
  ) {
    return this.agenda.feed({ from, days: int(days), lang });
  }

  @Get('highlights')
  @ApiOperation({
    summary:
      'The highlights rail: each series’ current edition, on now, upcoming or ended',
  })
  @ApiQuery({ name: 'lang', required: false, enum: ['es', 'en'] })
  highlights(@Query('lang') lang?: string) {
    return this.agenda.highlights({ lang });
  }

  @Get('series')
  @ApiOperation({
    summary:
      'Series whose next edition is expected within the window, soonest first',
  })
  @ApiQuery({
    name: 'nextWithin',
    required: false,
    description: 'Days, 365 by default',
  })
  @ApiQuery({ name: 'lang', required: false, enum: ['es', 'en'] })
  comingUp(
    @Query('nextWithin') nextWithin?: string,
    @Query('lang') lang?: string,
  ) {
    return this.agenda.comingUp({ nextWithin: int(nextWithin), lang });
  }

  @Get('series/:id')
  @ApiOperation({
    summary: 'One series by id or slug, with its current edition',
  })
  @ApiParam({ name: 'id' })
  @ApiQuery({ name: 'lang', required: false, enum: ['es', 'en'] })
  series(@Param('id') id: string, @Query('lang') lang?: string) {
    return this.agenda.series({ id, lang });
  }

  @Get('events/:id')
  @ApiOperation({ summary: 'One event of any type by id or slug' })
  @ApiParam({ name: 'id' })
  @ApiQuery({
    name: 'include',
    required: false,
    description: 'children,occurrences',
  })
  @ApiQuery({ name: 'lang', required: false, enum: ['es', 'en'] })
  event(
    @Param('id') id: string,
    @Query('include') include?: string,
    @Query('lang') lang?: string,
  ) {
    return this.agenda.event({ id, include: list(include), lang });
  }

  @Get('events/:id/schedule')
  @ApiOperation({
    summary:
      'An edition’s or programme’s sessions on one day, and how many each day has',
  })
  @ApiParam({ name: 'id' })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({
    name: 'kinds',
    required: false,
    description: 'Comma-separated kind codes',
  })
  @ApiQuery({
    name: 'pricing',
    required: false,
    enum: ['free', 'paid', 'mixed', 'unknown'],
  })
  @ApiQuery({ name: 'placeId', required: false })
  @ApiQuery({ name: 'lang', required: false, enum: ['es', 'en'] })
  schedule(
    @Param('id') id: string,
    @Query('date') date?: string,
    @Query('kinds') kinds?: string,
    @Query('pricing') pricing?: string,
    @Query('placeId') placeId?: string,
    @Query('lang') lang?: string,
  ) {
    return this.agenda.schedule({
      id,
      date,
      kinds: list(kinds),
      pricing,
      placeId,
      lang,
    });
  }

  @Get('places')
  @ApiOperation({ summary: 'Places by kind, by distance when `near` is given' })
  @ApiQuery({
    name: 'kinds',
    required: false,
    description: 'e.g. venue.museum',
  })
  @ApiQuery({
    name: 'near',
    required: false,
    description: 'longitude,latitude',
  })
  @ApiQuery({
    name: 'radius',
    required: false,
    description: 'Metres, 2000 by default',
  })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'lang', required: false, enum: ['es', 'en'] })
  places(
    @Query('kinds') kinds?: string,
    @Query('near') near?: string,
    @Query('radius') radius?: string,
    @Query('limit') limit?: string,
    @Query('lang') lang?: string,
  ) {
    return this.agenda.places({
      kinds: list(kinds),
      near: point(near),
      radius: int(radius),
      limit: int(limit),
      lang,
    });
  }

  @Get('places/:id')
  @ApiOperation({ summary: 'One place by id or slug' })
  @ApiParam({ name: 'id' })
  @ApiQuery({ name: 'include', required: false, description: 'happening' })
  @ApiQuery({ name: 'lang', required: false, enum: ['es', 'en'] })
  place(
    @Param('id') id: string,
    @Query('include') include?: string,
    @Query('lang') lang?: string,
  ) {
    return this.agenda.place({ id, include: list(include), lang });
  }

  @Get('taxonomy')
  @ApiOperation({
    summary:
      'Every kind, place kind and notice kind code, with labels and icons',
  })
  @ApiQuery({ name: 'lang', required: false, enum: ['es', 'en'] })
  taxonomy(@Query('lang') lang?: string) {
    return this.agenda.taxonomy({ lang });
  }
}
