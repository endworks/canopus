import { Controller, Post, Request, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { LocalAuthGuard } from 'src/auth/local-auth.guard';
import { GoogleAuthResult } from 'src/models/sex-tracker.interface';
import { SexTrackerService } from 'src/services/sex-tracker.service';

@Controller('sex-tracker')
@ApiTags('sex-tracker')
export class SexTrackerController {
  constructor(private readonly sexTrackerService: SexTrackerService) {}

  @UseGuards(LocalAuthGuard)
  @Post('auth')
  @ApiOperation({ summary: 'auth' })
  @ApiResponse({
    status: 200,
    description: 'response',
    type: GoogleAuthResult,
  })
  async login(@Res({ passthrough: true }) res: Response, @Request() req) {
    return this.sexTrackerService.login(res, req.user);
  }
}
