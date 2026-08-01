import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DocsService } from './docs.service';

@Controller('v1/docs')
export class DocsController {
  constructor(private readonly docsService: DocsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Body()
    body: {
      microserviceId: string;
      title: string;
      version: string;
      openApiSpec: string;
      isPublic?: boolean;
    },
  ) {
    return this.docsService.createDoc(body);
  }

  @Get('public')
  async getPublic() {
    return this.docsService.getAllPublicDocs();
  }

  @UseGuards(JwtAuthGuard)
  @Get('service/:serviceId')
  async getByService(@Param('serviceId') serviceId: string) {
    return this.docsService.getDocsByService(serviceId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/visibility')
  async toggleVisibility(
    @Param('id') id: string,
    @Body('isPublic') isPublic: boolean,
  ) {
    return this.docsService.toggleVisibility(id, isPublic);
  }
}
