import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TallyConnection } from './entities/tally-connection.entity';
import { TallyConnectionService } from './tally-connection.service';

@Module({
  imports: [TypeOrmModule.forFeature([TallyConnection])],
  providers: [TallyConnectionService],
  exports: [TallyConnectionService],
})
export class TallyConnectionModule {}
