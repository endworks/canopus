import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Cinema, CinemaDetails } from '../models/zine.interface';
import { ZineService } from '../services/zine.service';

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
  async zineCinemas() {
    return this.zineService.getCinemas();
  }

  @Get('cinema/:id')
  @ApiOperation({ summary: 'Get cinema by ID' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({
    status: 200,
    description: 'Return cinema and movies by ID',
    type: CinemaDetails,
  })
  async zineCinema(@Param('id') id: string) {
    return this.zineService.getCinema(id);
  }

  @Get('cinema/:id/pro')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({
    summary: '[BETA] Get advanced details about cinema by ID',
  })
  @ApiResponse({
    status: 200,
    description: '[BETA] Return advanced details about cinema',
    type: CinemaDetails,
  })
  async zineCinemaPro(@Param('id') id: string) {
    return this.zineService.getCinemaPro(id);
  }
}
