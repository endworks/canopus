import { Controller, Post, Request, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AuthBody, GoogleAuthResult } from 'src/models/sex-tracker.interface';
import { SexTrackerService } from 'src/services/sex-tracker.service';

@Controller('sex-tracker')
@ApiTags('sex-tracker')
export class SexTrackerController {
  constructor(private readonly sexTrackerService: SexTrackerService) {}

  @UseGuards(AuthGuard('local'))
  @Post('auth')
  @ApiOperation({ summary: 'auth' })
  @ApiBody({
    type: [AuthBody],
    schema: {
      $ref: getSchemaPath(AuthBody),
      example: [{ username: 'john', password: 'changeme' }],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'response',
    type: GoogleAuthResult,
  })
  async login(@Res({ passthrough: true }) res: Response, @Request() req) {
    return this.sexTrackerService.login(res, req.user);
  }
}
