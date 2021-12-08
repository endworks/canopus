import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  Cinema,
  CinemaDetailsBasic,
  CinemaDetails,
} from '../models/zine.interface';
import { ZineService } from '../services/zine.service';
import { Response } from 'express';

@Controller('zine')
@ApiTags('zine')
export class ZineController {
  constructor(private readonly zineService: ZineService) {}

  @Get('cinema')
  @ApiOperation({ summary: 'Get cinemas' })
  @ApiResponse({
    status: 200,
    description: 'Return cinemas',
    type: [Cinema],
  })
  async zineCinemas(@Res({ passthrough: true }) res: Response) {
    return this.zineService.getCinemas(res);
  }

  @Get('cinema/:id')
  @ApiOperation({ summary: 'Get cinema and movies by ID' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({
    status: 200,
    description: 'Return cinema and movies by ID',
    type: CinemaDetails,
  })
  async zineCinema(
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
  ) {
    return this.zineService.getCinema(res, id);
  }

  @Get('cinema/:id/basic')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({
    summary: 'Get cinema and basic details about movies by ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Return cinema and basic details about movies by ID',
    type: CinemaDetailsBasic,
  })
  async zineCinemaBasic(
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
  ) {
    return this.zineService.getCinemaBasic(res, id);
  }
}
