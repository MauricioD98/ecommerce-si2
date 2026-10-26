import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from "class-validator";
import { i18nMessage } from "../../../i18n/i18n-message";

export class RegisterDto {

    @ApiProperty({
            description:'User email address',
            example:'john.doe@example.com',
        })
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @ApiProperty({
        description: 'User password',
        example: 'StrongP@ssw0rd!',
    })
    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, {message: i18nMessage('validation.PASSWORD_STRONG')})
    password: string;
   
    @ApiProperty({
        description:'User first name',
        example:'John',
        required:false,
    })
    @IsOptional()
    @IsString()
    firstName?: string;


    @ApiProperty({
        description:'User last name',
        example:'Doe',
        required:false,
    })
    @IsOptional()
    @IsString()
    lastName?: string;

    // Teléfono de contacto (opcional)
    @ApiProperty({
        description:'User phone number',
        example:'+591 70000000',
        required:false,
    })
    @IsOptional()
    @IsString()
    phone?: string;

}