import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Response } from 'express';
import {
  Activity,
  ActivityInitiator,
  ActivityResult,
  ActivityType,
  AuthBody,
  BirthControl,
  GoogleAuthResult,
  Place,
  Practice,
} from 'src/models/sex-tracker.interface';
import { SexTrackerService } from 'src/services/sex-tracker.service';

@ApiTags('Sex tracker')
@Controller('sex')
export class SexTrackerController {
  constructor(private readonly sexTrackerService: SexTrackerService) {}

  @UseGuards(AuthGuard('local'))
  @Post('auth')
  @ApiOperation({ summary: 'auth' })
  @ApiBody({
    type: AuthBody,
    schema: {
      $ref: getSchemaPath(AuthBody),
      example: { username: 'john', password: 'changeme' },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'response',
    type: GoogleAuthResult,
  })
  async login(@Res({ passthrough: true }) res: Response, @Body() body) {
    return this.sexTrackerService.login(res, body);
  }

  @Get('activity')
  @ApiOperation({ summary: 'get list of activities' })
  @ApiParam({ name: 'solo', type: Boolean, required: false })
  @ApiResponse({
    status: 200,
    description: 'list of activities',
    type: ActivityResult,
  })
  async activities(@Res({ passthrough: true }) res: Response, solo?: boolean) {
    return this.sexTrackerService.activities(res, solo);
  }

  @Post('activity')
  @ApiOperation({ summary: 'create activity' })
  @ApiBody({
    type: Activity,
    schema: {
      $ref: getSchemaPath(Activity),
      example: {
        partner: 1,
        type: ActivityType.MASTURBATION,
        birth_control: BirthControl.CONDOM,
        partner_birth_control: BirthControl.NO_BIRTH_CONTROL,
        date: 1234,
        practices: [Practice.ANAL, Practice.CHOKING],
        location: null,
        notes: null,
        duration: 13,
        orgasms: 1,
        partner_orgasms: 1,
        place: Place.BEDROOM,
        initiator: ActivityInitiator.ME,
        rating: 4,
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'created activity',
    type: Activity,
  })
  async createActivity(
    @Res({ passthrough: true }) res: Response,
    @Body() body,
  ) {
    return this.sexTrackerService.createActivity(res, body);
  }

  @Get('activity/:id')
  @ApiOperation({ summary: 'get activity by id' })
  @ApiResponse({
    status: 200,
    description: 'activity by id',
    type: Activity,
  })
  async activityById(
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: number,
  ) {
    return this.sexTrackerService.activityById(res, id);
  }

  @Patch('activity/:id')
  @ApiOperation({ summary: 'update activity by id' })
  @ApiBody({
    type: Activity,
    schema: {
      $ref: getSchemaPath(Activity),
      example: {
        partner: 1,
        type: ActivityType.MASTURBATION,
        birth_control: BirthControl.CONDOM,
        partner_birth_control: BirthControl.NO_BIRTH_CONTROL,
        date: 1234,
        practices: [Practice.ANAL, Practice.CHOKING],
        location: null,
        notes: null,
        duration: 13,
        orgasms: 1,
        partner_orgasms: 1,
        place: Place.BEDROOM,
        initiator: ActivityInitiator.ME,
        rating: 4,
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'updated activity',
    type: Activity,
  })
  async updateActivityById(
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: number,
    @Body() body,
  ) {
    return this.sexTrackerService.updateActivityById(res, id, body);
  }

  @Delete('activity/:id')
  @ApiOperation({ summary: 'delete activity by id' })
  @ApiResponse({
    status: 200,
    description: 'deleted activity by id',
  })
  async deleteActivityById(
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: number,
  ) {
    return this.sexTrackerService.deleteActivityById(res, id);
  }
}
