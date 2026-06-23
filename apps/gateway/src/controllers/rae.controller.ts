import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RAEService } from 'src/services/rae.service';
import { TermSearchResults } from 'src/models/rae.interface';

@ApiTags('RAE definitions')
@Controller('rae')
export class RAEController {
  constructor(private readonly raeService: RAEService) {}

  @Get('search/:term')
  @ApiOperation({ summary: 'Search by term' })
  @ApiParam({ name: 'term', type: String })
  @ApiResponse({
    status: 200,
    description: 'Return term search results',
    type: TermSearchResults,
  })
  async termSearch(@Param('term') term: string) {
    return this.raeService.search(term);
  }
}
