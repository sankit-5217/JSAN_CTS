import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";

/** Zabbix object ids are numeric strings; reject anything else before it reaches Zabbix. */
@Injectable()
export class ZabbixIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^\d{1,20}$/.test(value ?? "")) {
      throw new BadRequestException("Expected a numeric Zabbix id");
    }
    return value;
  }
}
