import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { AGENDA_PATTERNS } from '@canopus/shared';
import { AgendaService } from '../services/agenda.service';

/**
 * `AGENDA_ADMIN_TOKEN`: one token, or `name:token` pairs separated by commas
 * so each editor's changes carry their name in the revisions.
 */
export const adminTokens = (value = ''): Map<string, string> => {
  const tokens = new Map<string, string>();
  for (const entry of value
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)) {
    const at = entry.indexOf(':');
    if (at > 0) tokens.set(entry.slice(at + 1), entry.slice(0, at));
    else tokens.set(entry, 'admin');
  }
  return tokens;
};

/** Who is asking, or a 401. Compared in constant time against every token. */
export const whoIs = (
  authorization: string | undefined,
  tokens: Map<string, string>,
): string => {
  const given = Buffer.from((authorization ?? '').replace(/^Bearer\s+/i, ''));
  for (const [token, name] of tokens) {
    const expected = Buffer.from(token);
    if (given.length === expected.length && timingSafeEqual(given, expected))
      return name;
  }
  throw new UnauthorizedException({
    statusCode: 401,
    error: { code: 'unauthorized', message: 'A valid admin token is required' },
  });
};

/**
 * The agenda's admin routes: the editorial store, reviews, runs.
 *
 * Behind a token from the first release (docs/agenda/README.md, decision 10).
 * The gateway has no authentication of its own, and these write the one copy
 * of the hand-written data and the archive's corrections. Kept out of the
 * public Swagger document.
 *
 * Keys may hold "/" (`pilar-2026/espacio-zity`): send it encoded, `%2F`.
 */
@ApiExcludeController()
@Controller(['zgz/agenda/v1/admin', 'agenda/v1/admin'])
export class AgendaAdminController {
  constructor(private readonly agenda: AgendaService) {}

  private by(authorization?: string) {
    return whoIs(authorization, adminTokens(process.env.AGENDA_ADMIN_TOKEN));
  }

  @Post('run')
  run(@Headers('authorization') auth?: string) {
    this.by(auth);
    return this.agenda.admin(AGENDA_PATTERNS.run);
  }

  @Get('status')
  status(@Headers('authorization') auth?: string) {
    this.by(auth);
    return this.agenda.admin(AGENDA_PATTERNS.status);
  }

  @Get('runs')
  runs(
    @Headers('authorization') auth?: string,
    @Query('limit') limit?: string,
  ) {
    this.by(auth);
    return this.agenda.admin(AGENDA_PATTERNS.runs, {
      limit: parseInt(limit ?? '', 10) || 20,
    });
  }

  @Get('export')
  export(@Headers('authorization') auth?: string) {
    this.by(auth);
    return this.agenda.admin(AGENDA_PATTERNS.editorialExport);
  }

  @Post('editorial/bulk')
  bulk(
    @Headers('authorization') auth: string,
    @Body()
    body: { items: { collection: string; doc: unknown }[]; reason: string },
  ) {
    const by = this.by(auth);
    return this.agenda.admin(AGENDA_PATTERNS.editorialBulk, { ...body, by });
  }

  @Get('editorial/:collection')
  list(
    @Headers('authorization') auth: string,
    @Param('collection') collection: string,
    @Query('state') state?: string,
  ) {
    this.by(auth);
    return this.agenda.admin(AGENDA_PATTERNS.editorialList, {
      collection,
      state,
    });
  }

  @Get('editorial/:collection/:key')
  get(
    @Headers('authorization') auth: string,
    @Param('collection') collection: string,
    @Param('key') key: string,
  ) {
    this.by(auth);
    return this.agenda.admin(AGENDA_PATTERNS.editorialGet, { collection, key });
  }

  @Put('editorial/:collection/:key')
  put(
    @Headers('authorization') auth: string,
    @Param('collection') collection: string,
    @Param('key') key: string,
    @Body()
    body: { doc: unknown; state?: string; verified?: unknown; reason: string },
  ) {
    const by = this.by(auth);
    return this.agenda.admin(AGENDA_PATTERNS.editorialPut, {
      ...body,
      collection,
      key,
      by,
    });
  }

  @Post('editorial/:collection/:key/publish')
  publish(
    @Headers('authorization') auth: string,
    @Param('collection') collection: string,
    @Param('key') key: string,
    @Body() body: { reason: string },
  ) {
    const by = this.by(auth);
    return this.agenda.admin(AGENDA_PATTERNS.editorialState, {
      collection,
      key,
      state: 'published',
      reason: body?.reason,
      by,
    });
  }

  @Post('editorial/:collection/:key/unpublish')
  unpublish(
    @Headers('authorization') auth: string,
    @Param('collection') collection: string,
    @Param('key') key: string,
    @Body() body: { reason: string },
  ) {
    const by = this.by(auth);
    return this.agenda.admin(AGENDA_PATTERNS.editorialState, {
      collection,
      key,
      state: 'draft',
      reason: body?.reason,
      by,
    });
  }

  @Get('editorial/:collection/:key/history')
  history(
    @Headers('authorization') auth: string,
    @Param('collection') collection: string,
    @Param('key') key: string,
  ) {
    this.by(auth);
    return this.agenda.admin(AGENDA_PATTERNS.editorialHistory, {
      collection,
      key,
    });
  }

  @Post('revisions/:id/revert')
  revert(
    @Headers('authorization') auth: string,
    @Param('id') revisionId: string,
    @Body() body: { reason: string },
  ) {
    const by = this.by(auth);
    return this.agenda.admin(AGENDA_PATTERNS.editorialRevert, {
      revisionId,
      reason: body?.reason,
      by,
    });
  }

  @Get('reviews')
  reviews(
    @Headers('authorization') auth: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
  ) {
    this.by(auth);
    return this.agenda.admin(AGENDA_PATTERNS.reviews, {
      status: status ?? 'open',
      kind,
    });
  }

  @Post('reviews/:id')
  resolve(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Body() body: { action: 'resolve' | 'dismiss'; note?: string },
  ) {
    const by = this.by(auth);
    return this.agenda.admin(AGENDA_PATTERNS.reviewResolve, {
      id,
      ...body,
      by,
    });
  }
}
